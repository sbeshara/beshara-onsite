import { getAccess } from "@/lib/access";
import { billing, INVOICE_LABEL } from "@/lib/billing";
import { docNumber } from "@/lib/estimates";
import { usd } from "@/lib/office";
import { createClient } from "@/lib/supabase/server";
import { InvoiceButton, InvoiceRowActions, StepReached } from "../../../InvoiceBits";

export const metadata = { title: "Invoicing · Beshara OnSite" };
const day = (d: string) => new Date(d.length === 10 ? d + "T12:00:00" : d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

export default async function JobInvoicing({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { me } = await getAccess();
  const canSend = me.role === "owner" || me.role === "admin";
  const supabase = await createClient();
  const [{ steps, invoices }, { data: job }] = await Promise.all([
    billing(supabase, id),
    supabase.from("projects").select("job_number, customers(email, customer_contacts(email, is_primary))").eq("id", id).maybeSingle(),
  ]);
  const c = job?.customers as unknown as { email: string | null; customer_contacts: { email: string | null; is_primary: boolean }[] } | null;
  const email = c?.customer_contacts.find((x) => x.is_primary)?.email ?? c?.customer_contacts.find((x) => x.email)?.email ?? c?.email ?? "";
  const contract = [...new Map(steps.map((s) => [s.estimate.id, s.estimate.total])).values()].reduce((a, b) => a + b, 0);
  const billed = invoices.filter((i) => i.status !== "void" && i.status !== "draft").reduce((s, i) => s + Number(i.amount), 0);
  const paid = invoices.reduce((s, i) => s + Number(i.paid_total), 0);
  const estimates = [...new Map(steps.map((s) => [s.estimate.id, s.estimate])).values()];
  return (
    <div className="page">
      <div className="kvrow">
        <div><span>Contract (signed)</span><b>{usd(contract)}</b></div>
        <div><span>Invoiced</span><b>{usd(billed)}</b></div>
        <div><span>Paid</span><b>{usd(paid)}</b></div>
        <div><span>Left to bill</span><b>{usd(Math.max(0, contract - billed))}</b></div>
      </div>
      {estimates.length ? estimates.map((e) => (
        <section key={e.id} className="ocard">
          <div className="sec-h" style={{ marginBottom: 0 }}><h2>{e.name}</h2><span>{e.kind} {docNumber(job?.job_number, e.seq)} · {usd(e.total)}</span></div>
          <div className="otable-wrap">
            <table className="otable">
              <thead><tr><th>Payment step</th><th className="r">%</th><th className="r">Amount</th><th>Status</th><th /></tr></thead>
              <tbody>
                {steps.filter((s) => s.estimate.id === e.id).map((s) => {
                  const inv = s.invoice;
                  return (
                    <tr key={s.id}>
                      <td><b>{s.name}</b></td>
                      <td className="r">{s.percent}%</td>
                      <td className="r">{usd(s.amount, true)}</td>
                      <td>
                        {inv ? (
                          <>
                            <span className={`pill ${inv.status === "paid" ? "bc-done" : inv.status === "partial" || inv.status === "sent" ? "warn" : ""}`}>{INVOICE_LABEL[inv.status]}</span>{" "}
                            <span className="fine">Invoice {docNumber(job?.job_number, inv.seq)}{inv.sent_at ? ` · sent ${day(inv.sent_at)}` : ""}</span>
                            {inv.invoice_payments.map((p, i) => <small key={i}>Paid {usd(Number(p.amount), true)} on {day(p.paid_on)}{p.method ? ` · ${p.method}` : ""}</small>)}
                            {inv.status === "partial" && <small className="err">Balance {usd(Number(inv.amount) - Number(inv.paid_total), true)}</small>}
                            {inv.qbo_error && <small className="err">{inv.qbo_error}</small>}
                          </>
                        ) : s.reached_at ? (
                          <span className="pill warn">Ready to invoice</span>
                        ) : (
                          <span className="fine">Not reached yet</span>
                        )}
                      </td>
                      <td className="r" style={{ whiteSpace: "nowrap" }}>
                        {inv ? (
                          <InvoiceRowActions id={inv.id} status={inv.status} inQbo={!!inv.qbo_invoice_id} canSend={canSend} />
                        ) : (
                          <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
                            <StepReached stepId={s.id} projectId={id} reached={!!s.reached_at} />
                            {s.reached_at && <InvoiceButton projectId={id} estimateId={e.id} stepId={s.id} amount={s.amount} description={`${s.name} (${s.percent}% of ${e.kind} ${docNumber(job?.job_number, e.seq)})`} email={email} canSend={canSend} />}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )) : <p className="empty">Nothing to invoice until a proposal is signed.</p>}
      {invoices.some((i) => !i.step_id) && (
        <section className="ocard">
          <h2>Other invoices</h2>
          {invoices.filter((i) => !i.step_id).map((i) => (
            <div key={i.id} className="sumrow"><span>{docNumber(job?.job_number, i.seq)} · {i.description}</span><b>{usd(Number(i.amount), true)} · {INVOICE_LABEL[i.status]}</b></div>
          ))}
        </section>
      )}
      {canSend && estimates.length > 0 && (
        <div><InvoiceButton projectId={id} amount={0} description="" email={email} label="+ Other invoice" canSend={canSend} /></div>
      )}
    </div>
  );
}
