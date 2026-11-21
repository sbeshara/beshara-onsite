import "server-only";
import { api, ensureCustomer, ensureItem, methodLabel, type QboPayment } from "./qbo";
import { createAdminClient } from "./supabase/admin";

// Pushes an OnSite invoice to QuickBooks Online and has QuickBooks email it
// to the client (its email carries the pay-online link when QuickBooks
// Payments is on). Returns the invoice's QuickBooks ID.
export async function pushAndSend(invoiceId: string, userId: string) {
  const db = createAdminClient();
  const { data: inv } = await db
    .from("invoices")
    .select("id, seq, amount, description, memo, issued_on, due_on, email_to, status, qbo_invoice_id, projects(job_number, name, customers(id, name, email, address, qbo_customer_id))")
    .eq("id", invoiceId)
    .maybeSingle();
  if (!inv) throw new Error("Invoice not found.");
  if (inv.status === "void") throw new Error("This invoice was voided.");
  const job = inv.projects as unknown as { job_number: string | null; name: string; customers: { id: string; name: string; email: string | null; address: string | null; qbo_customer_id: string | null } | null };
  if (!job.customers) throw new Error("Pick the job's customer (in Details) before invoicing.");
  if (!inv.email_to) throw new Error("Add the email address the invoice goes to.");

  try {
    let qboId = inv.qbo_invoice_id as string | null;
    if (!qboId) {
      const [customer, item] = await Promise.all([ensureCustomer(job.customers), ensureItem()]);
      const amount = Number(inv.amount);
      const created = await api<{ Invoice: { Id: string } }>("POST", "/invoice", {
        CustomerRef: { value: customer },
        DocNumber: (job.job_number ? `${job.job_number}-${inv.seq}` : String(inv.seq)).slice(0, 21),
        TxnDate: inv.issued_on,
        ...(inv.due_on ? { DueDate: inv.due_on } : {}),
        BillEmail: { Address: inv.email_to },
        ...(inv.memo ? { CustomerMemo: { value: inv.memo.slice(0, 1000) } } : {}),
        Line: [{ Amount: amount, DetailType: "SalesItemLineDetail", Description: `${job.name}: ${inv.description}`.slice(0, 4000), SalesItemLineDetail: { ItemRef: { value: item }, Qty: 1, UnitPrice: amount } }],
      });
      qboId = created.Invoice.Id;
      await db.from("invoices").update({ qbo_invoice_id: qboId, qbo_synced_at: new Date().toISOString(), qbo_error: null }).eq("id", invoiceId);
    }
    await api("POST", `/invoice/${qboId}/send?sendTo=${encodeURIComponent(inv.email_to)}`, undefined, true);
    await db
      .from("invoices")
      .update({ status: inv.status === "draft" ? "sent" : inv.status, sent_at: new Date().toISOString(), sent_by: userId, qbo_error: null })
      .eq("id", invoiceId);
    return qboId;
  } catch (e) {
    await db.from("invoices").update({ qbo_error: (e as Error).message.slice(0, 500) }).eq("id", invoiceId);
    throw e;
  }
}

// Records a QuickBooks payment against the OnSite invoices it pays.
export async function recordPayment(p: QboPayment) {
  const db = createAdminClient();
  let matched = 0;
  for (const line of p.Line ?? []) {
    for (const t of (line.LinkedTxn ?? []).filter((x) => x.TxnType === "Invoice")) {
      const { data: inv } = await db.from("invoices").select("id").eq("qbo_invoice_id", t.TxnId).maybeSingle();
      if (!inv) continue;
      await db.from("invoice_payments").upsert(
        { invoice_id: inv.id, amount: line.Amount, paid_on: p.TxnDate, method: methodLabel(p), qbo_payment_id: p.Id },
        { onConflict: "invoice_id,qbo_payment_id" },
      );
      matched++;
    }
  }
  return matched;
}

export async function removePayment(qboPaymentId: string) {
  await createAdminClient().from("invoice_payments").delete().eq("qbo_payment_id", qboPaymentId);
}

// Pulls payments changed in QuickBooks since the last check (up to 30 days back).
export async function checkPayments() {
  const db = createAdminClient();
  const { data: c } = await db.from("qbo_connection").select("last_payment_check").maybeSingle();
  const floor = Date.now() - 29 * 864e5;
  const since = new Date(Math.max(floor, c?.last_payment_check ? new Date(c.last_payment_check).getTime() - 5 * 60e3 : floor)).toISOString();
  const started = new Date().toISOString();
  const r = await api<{ CDCResponse: { QueryResponse: { Payment?: (QboPayment & { status?: string })[] }[] }[] }>("GET", `/cdc?entities=Payment&changedSince=${encodeURIComponent(since)}`);
  let recorded = 0;
  for (const qr of r.CDCResponse?.[0]?.QueryResponse ?? []) {
    for (const p of qr.Payment ?? []) {
      if (p.status === "Deleted") await removePayment(p.Id);
      else recorded += await recordPayment(p);
    }
  }
  await db.from("qbo_connection").update({ last_payment_check: started }).eq("id", true);
  return recorded;
}
