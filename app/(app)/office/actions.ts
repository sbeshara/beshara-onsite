"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getAccess } from "@/lib/access";
import { ALL_STATUSES } from "@/lib/constants";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type Result = { error?: string; ok?: string };

const clean = (v: FormDataEntryValue | null) => String(v ?? "").trim();
const orNull = (v: FormDataEntryValue | null) => clean(v) || null;
const money = (v: FormDataEntryValue | null) => {
  const s = clean(v).replace(/[$,\s]/g, "");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
};

// The office tools are for the Owner, Admins, Senior PMs and Preconstruction
// Managers. The database enforces the same rule (sees_numbers()).
async function requireOffice() {
  const a = await getAccess();
  if (!a.seesNumbers) throw new Error("Only the Owner, Admin, Senior PM or Preconstruction Manager can do this.");
  return a;
}

async function nextJobNumber() {
  const { data } = await createAdminClient().from("projects").select("job_number").not("job_number", "is", null);
  const nums = (data ?? []).map((r) => parseInt(String(r.job_number), 10)).filter((n) => Number.isFinite(n));
  return String(nums.length ? Math.max(...nums) + 1 : 1001);
}

// ---------------------------------------------------------------------------
// Jobs and leads
// ---------------------------------------------------------------------------

export async function createLead(_prev: Result, form: FormData): Promise<Result> {
  let id: string;
  try {
    const { me } = await requireOffice();
    const name = clean(form.get("name"));
    if (!name) return { error: "Give the job a name, e.g. the practice name and what you're building." };
    const supabase = await createClient();
    let customerId = orNull(form.get("customer_id"));
    const newCustomer = clean(form.get("new_customer"));
    if (!customerId && newCustomer) {
      const { data, error } = await supabase.from("customers").insert({ name: newCustomer, created_by: me.id }).select("id").single();
      if (error || !data) return { error: "Couldn't add the customer. Try again." };
      customerId = data.id;
    }
    const status = clean(form.get("status")) || "New Lead";
    if (!(ALL_STATUSES as readonly string[]).includes(status)) return { error: "Pick a status." };
    // Saved with the server key: only Owner/Admin may insert projects directly (checked above).
    const { data, error } = await createAdminClient()
      .from("projects")
      .insert({
        name,
        status,
        town: clean(form.get("town")),
        address: orNull(form.get("address")),
        job_type: orNull(form.get("job_type")),
        notes: orNull(form.get("notes")),
        customer_id: customerId,
        job_number: clean(form.get("job_number")) || (await nextJobNumber()),
        created_by: me.id,
      })
      .select("id")
      .single();
    if (error || !data) return { error: error?.code === "23505" ? "That job number is already used." : "Couldn't create the job. Try again." };
    id = data.id;
  } catch (e) {
    return { error: (e as Error).message };
  }
  revalidatePath("/", "layout");
  redirect(`/projects/${id}/details`);
}

export async function updateJob(_prev: Result, form: FormData): Promise<Result> {
  try {
    await requireOffice();
    const id = clean(form.get("id"));
    const name = clean(form.get("name"));
    if (!name) return { error: "The job needs a name." };
    const status = clean(form.get("status"));
    if (!(ALL_STATUSES as readonly string[]).includes(status)) return { error: "Pick a status." };
    const supabase = await createClient();
    const { error } = await supabase
      .from("projects")
      .update({
        name,
        status,
        town: clean(form.get("town")),
        address: orNull(form.get("address")),
        job_type: orNull(form.get("job_type")),
        notes: orNull(form.get("notes")),
        customer_id: orNull(form.get("customer_id")),
        job_number: orNull(form.get("job_number")),
      })
      .eq("id", id);
    if (error) return { error: error.code === "23505" ? "That job number is already used." : "Couldn't save. Try again." };
    revalidatePath("/", "layout");
    return { ok: "Saved." };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

// ---------------------------------------------------------------------------
// Customers and contacts
// ---------------------------------------------------------------------------

export async function saveCustomer(_prev: Result, form: FormData): Promise<Result> {
  let newId: string | null = null;
  try {
    const { me } = await requireOffice();
    const id = orNull(form.get("id"));
    const row = {
      name: clean(form.get("name")),
      email: orNull(form.get("email")),
      phone: orNull(form.get("phone")),
      address: orNull(form.get("address")),
      notes: orNull(form.get("notes")),
    };
    if (!row.name) return { error: "Enter the customer's name." };
    const supabase = await createClient();
    if (id) {
      const { error } = await supabase.from("customers").update(row).eq("id", id);
      if (error) return { error: "Couldn't save. Try again." };
      revalidatePath("/office/customers", "layout");
      return { ok: "Saved." };
    }
    const { data, error } = await supabase.from("customers").insert({ ...row, created_by: me.id }).select("id").single();
    if (error || !data) return { error: "Couldn't add the customer. Try again." };
    newId = data.id;
  } catch (e) {
    return { error: (e as Error).message };
  }
  revalidatePath("/office/customers", "layout");
  redirect(`/office/customers/${newId}`);
}

export async function deleteCustomer(id: string): Promise<Result> {
  try {
    await requireOffice();
    const supabase = await createClient();
    const { count } = await supabase.from("projects").select("id", { count: "exact", head: true }).eq("customer_id", id);
    if (count) return { error: "This customer has jobs. Move or delete those first." };
    const { error } = await supabase.from("customers").delete().eq("id", id);
    if (error) return { error: "Couldn't delete. Try again." };
  } catch (e) {
    return { error: (e as Error).message };
  }
  revalidatePath("/office/customers", "layout");
  redirect("/office/customers");
}

export async function saveContact(_prev: Result, form: FormData): Promise<Result> {
  try {
    await requireOffice();
    const id = orNull(form.get("id"));
    const customerId = clean(form.get("customer_id"));
    const row = {
      name: clean(form.get("name")),
      title: orNull(form.get("title")),
      email: orNull(form.get("email")),
      phone: orNull(form.get("phone")),
      is_primary: form.get("is_primary") === "on",
    };
    if (!row.name) return { error: "Enter the contact's name." };
    const supabase = await createClient();
    if (row.is_primary) await supabase.from("customer_contacts").update({ is_primary: false }).eq("customer_id", customerId);
    const { error } = id
      ? await supabase.from("customer_contacts").update(row).eq("id", id)
      : await supabase.from("customer_contacts").insert({ ...row, customer_id: customerId });
    if (error) return { error: "Couldn't save the contact. Try again." };
    revalidatePath(`/office/customers/${customerId}`);
    return { ok: id ? "Contact saved." : "Contact added." };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function deleteContact(id: string, customerId: string): Promise<Result> {
  try {
    await requireOffice();
    const { error } = await (await createClient()).from("customer_contacts").delete().eq("id", id);
    if (error) return { error: "Couldn't remove the contact. Try again." };
    revalidatePath(`/office/customers/${customerId}`);
    return { ok: "Contact removed." };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

export async function saveGroup(_prev: Result, form: FormData): Promise<Result> {
  try {
    await requireOffice();
    const id = orNull(form.get("id"));
    const row = { name: clean(form.get("name")), description: clean(form.get("description")), parent_id: orNull(form.get("parent_id")) };
    if (!row.name) return { error: "Name the cost group." };
    const supabase = await createClient();
    const { error } = id ? await supabase.from("cost_groups").update(row).eq("id", id) : await supabase.from("cost_groups").insert(row);
    if (error) return { error: "Couldn't save the cost group. Try again." };
    revalidatePath("/office/catalog");
    return { ok: id ? "Cost group saved." : "Cost group added." };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function archiveGroup(id: string): Promise<Result> {
  try {
    await requireOffice();
    const { error } = await (await createClient()).from("cost_groups").update({ archived: true }).eq("id", id);
    if (error) return { error: "Couldn't remove it. Try again." };
    revalidatePath("/office/catalog");
    return { ok: "Cost group removed. Its items stay in the catalog without a group." };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function saveItem(_prev: Result, form: FormData): Promise<Result> {
  try {
    await requireOffice();
    const id = orNull(form.get("id"));
    const unitCost = money(form.get("unit_cost"));
    const unitPrice = money(form.get("unit_price"));
    if (Number.isNaN(unitCost) || Number.isNaN(unitPrice)) return { error: "Unit cost and unit price must be numbers." };
    const row = {
      name: clean(form.get("name")),
      description: clean(form.get("description")),
      cost_group_id: orNull(form.get("cost_group_id")),
      cost_type_id: Number(form.get("cost_type_id")) || null,
      unit_id: Number(form.get("unit_id")) || null,
      unit_cost: unitCost,
      unit_price: unitPrice,
    };
    if (!row.name) return { error: "Name the item." };
    const supabase = await createClient();
    const { error } = id ? await supabase.from("cost_items").update(row).eq("id", id) : await supabase.from("cost_items").insert(row);
    if (error) return { error: "Couldn't save the item. Try again." };
    revalidatePath("/office/catalog");
    return { ok: id ? "Item saved." : "Item added." };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function archiveItem(id: string): Promise<Result> {
  try {
    await requireOffice();
    const { error } = await (await createClient()).from("cost_items").update({ archived: true }).eq("id", id);
    if (error) return { error: "Couldn't remove it. Try again." };
    revalidatePath("/office/catalog");
    return { ok: "Item removed from the catalog." };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

// ---------------------------------------------------------------------------
// JobTread import (Owner and Admin)
// ---------------------------------------------------------------------------

export async function runJobTreadImport(): Promise<Result> {
  try {
    const { me } = await requireOffice();
    if (me.role !== "owner" && me.role !== "admin") return { error: "Only the Owner or Admin can run the import." };
    const { runImport } = await import("@/lib/jobtread-import");
    const r = await runImport(me.id);
    revalidatePath("/", "layout");
    return {
      ok: `Imported ${r.catalog} catalog groups and items, ${r.customers} customers with ${r.contacts} contacts, ${r.jobsCreated} new jobs and ${r.jobsUpdated} updated. ${r.merged} invoice jobs were attached to their real jobs.`,
    };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

// ---------------------------------------------------------------------------
// Estimates
// ---------------------------------------------------------------------------

const DEFAULT_STEPS: Record<string, { name: string; percent: number }[]> = {
  Proposal: [
    { name: "Deposit on signing", percent: 10 },
    { name: "Rough-in complete", percent: 30 },
    { name: "Finishes complete", percent: 50 },
    { name: "Final walkthrough", percent: 10 },
  ],
  "Change Order": [{ name: "Due on approval", percent: 100 }],
  "Additional Scope": [{ name: "Due on approval", percent: 100 }],
};

export async function createEstimate(_prev: Result, form: FormData): Promise<Result> {
  let path: string;
  try {
    const { me } = await requireOffice();
    const projectId = clean(form.get("project_id"));
    const template = orNull(form.get("template"));
    const supabase = await createClient();
    // The document template sets the type, intro and terms.
    const docTplId = orNull(form.get("doc_template"));
    const { data: docTpl } = docTplId ? await supabase.from("document_templates").select("id, name, kind, intro, terms").eq("id", docTplId).maybeSingle() : { data: null };
    const kind = docTpl?.kind ?? (clean(form.get("kind")) || "Proposal");
    if (!DEFAULT_STEPS[kind]) return { error: "Pick a document type." };
    const { data: est, error } = await supabase
      .from("estimates")
      .insert({ project_id: projectId, kind, name: clean(form.get("name")) || docTpl?.name || kind, intro: docTpl?.intro ?? "", terms: docTpl?.terms ?? "", template_id: docTpl?.id ?? null, created_by: me.id })
      .select("id")
      .single();
    if (error || !est) return { error: "Couldn't create the estimate. Try again." };
    await supabase.from("estimate_payment_steps").insert(DEFAULT_STEPS[kind].map((s, i) => ({ ...s, estimate_id: est.id, position: i })));

    // Start from a catalog group: its sub-groups become the estimate's groups,
    // each with its catalog items (quantity 0 until measured or typed in).
    if (template) {
      const [{ data: groups }, { data: items }] = await Promise.all([
        supabase.from("cost_groups").select("id, parent_id, name, description, position").eq("archived", false),
        supabase.from("cost_items").select("id, cost_group_id, name, description, cost_type_id, unit_id, quantity, unit_cost, unit_price, position").eq("archived", false),
      ]);
      const root = (groups ?? []).find((g) => g.id === template);
      if (root) {
        const kids = (groups ?? []).filter((g) => g.parent_id === root.id).sort((a, b) => a.position - b.position);
        const use = kids.length ? kids : [root];
        for (const [i, g] of use.entries()) {
          const { data: eg } = await supabase
            .from("estimate_groups")
            .insert({ estimate_id: est.id, name: g.name, description: g.description, position: i, client_view: kind === "Proposal" ? "total" : "items" })
            .select("id")
            .single();
          if (!eg) continue;
          const its = (items ?? []).filter((x) => x.cost_group_id === g.id).sort((a, b) => a.position - b.position);
          if (its.length)
            await supabase.from("estimate_items").insert(
              its.map((x, n) => ({
                estimate_id: est.id, group_id: eg.id, catalog_item_id: x.id, name: x.name, description: x.description,
                cost_type_id: x.cost_type_id, unit_id: x.unit_id, quantity: x.quantity ?? 0, unit_cost: x.unit_cost ?? 0, unit_price: x.unit_price ?? 0, position: n,
              })),
            );
        }
      }
    } else {
      await supabase.from("estimate_groups").insert({ estimate_id: est.id, name: "New group", position: 0, client_view: kind === "Proposal" ? "total" : "items" });
    }
    // A lead that gets its first estimate is being estimated.
    await supabase.from("projects").update({ status: "Estimating" }).eq("id", projectId).eq("status", "New Lead");
    path = `/projects/${projectId}/estimates/${est.id}`;
  } catch (e) {
    return { error: (e as Error).message };
  }
  redirect(path);
}

export async function deleteEstimate(id: string, projectId: string): Promise<Result> {
  try {
    await requireOffice();
    const { error } = await (await createClient()).from("estimates").delete().eq("id", id).neq("status", "approved");
    if (error) return { error: "Couldn't delete it. Signed estimates can't be deleted." };
  } catch (e) {
    return { error: (e as Error).message };
  }
  revalidatePath(`/projects/${projectId}/estimates`);
  redirect(`/projects/${projectId}/estimates`);
}

// ---------------------------------------------------------------------------
// Sending for e-signature
// ---------------------------------------------------------------------------

export async function sendEstimate(estimateId: string, projectId: string, chatId: string | null, message: string): Promise<Result> {
  try {
    const { me } = await requireOffice();
    const supabase = await createClient();
    const { data: est } = await supabase.from("estimates").select("status, kind, name").eq("id", estimateId).maybeSingle();
    if (!est) return { error: "Estimate not found." };
    if (est.status === "approved") return { error: "It's already signed." };
    const { buildClientCopy } = await import("@/app/(app)/projects/[id]/(office)/estimates/load");
    const copy = await buildClientCopy(supabase, projectId, estimateId);
    if (!copy) return { error: "Couldn't build the client's copy." };
    if (!copy.groups.length || copy.total <= 0) return { error: "Add some priced items before sending." };
    const pct = copy.steps.reduce((s, x) => s + x.percent, 0);
    if (copy.steps.length && Math.abs(pct - 100) > 0.01) return { error: `The payment schedule adds up to ${pct}%. Make it 100% before sending.` };
    const { error } = await supabase
      .from("estimates")
      .update({ status: "pending", client_copy: copy, sent_at: new Date().toISOString(), sent_by: me.id, declined_at: null, decline_reason: null })
      .eq("id", estimateId);
    if (error) return { error: "Couldn't send it. Try again." };
    // Tell the client in their chat (they get the usual email and phone notification).
    if (chatId) {
      const link = `/projects/${projectId}/proposals?doc=${estimateId}`;
      const body = `${message.trim() || `Your ${est.kind.toLowerCase()} is ready to review and sign.`}\n\n[Review and sign ${est.kind} ${copy.number}](${link})`;
      const { error: mErr } = await supabase.from("messages").insert({ chat_id: chatId, author_id: me.id, body });
      if (mErr) return { ok: "Sent. It's waiting in the client's Proposals tab, but the chat message didn't post." };
    }
    const { count } = await createAdminClient().from("project_members").select("user_id, profiles!inner(role)", { count: "exact", head: true }).eq("project_id", projectId).eq("profiles.role", "client");
    revalidatePath(`/projects/${projectId}/estimates`, "layout");
    return { ok: count ? `Sent ${est.kind} ${copy.number}. The client can review and sign it in OnSite.` : `Sent, but no client is invited to this project yet. Invite them from the project page so they can sign.` };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

// Takes a sent estimate back to draft so it can be changed (the client stops seeing it).
export async function recallEstimate(estimateId: string, projectId: string): Promise<Result> {
  try {
    await requireOffice();
    const { error } = await (await createClient()).from("estimates").update({ status: "draft", client_copy: null }).eq("id", estimateId).eq("status", "pending");
    if (error) return { error: "Couldn't take it back. Try again." };
    revalidatePath(`/projects/${projectId}/estimates`, "layout");
    return { ok: "Taken back to draft. The client no longer sees it." };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

// ---------------------------------------------------------------------------
// Invoicing (QuickBooks Online)
// ---------------------------------------------------------------------------

async function requireBilling() {
  const a = await requireOffice();
  if (a.me.role !== "owner" && a.me.role !== "admin") throw new Error("Only the Owner or Admin can create and send invoices.");
  return a;
}

export async function setStepReached(stepId: string, projectId: string, on: boolean): Promise<Result> {
  try {
    const { me } = await requireOffice();
    const { error } = await (await createClient())
      .from("estimate_payment_steps")
      .update(on ? { reached_at: new Date().toISOString(), reached_by: me.id } : { reached_at: null, reached_by: null })
      .eq("id", stepId);
    if (error) return { error: "Couldn't update that step. Try again." };
    revalidatePath(`/projects/${projectId}/invoicing`);
    revalidatePath("/office/invoicing");
    return { ok: on ? "Marked ready to invoice." : "Marked not reached." };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function createInvoice(_prev: Result, form: FormData): Promise<Result> {
  try {
    const { me } = await requireBilling();
    const projectId = clean(form.get("project_id"));
    const amount = money(form.get("amount"));
    if (!amount || Number.isNaN(amount) || amount <= 0) return { error: "Enter the invoice amount." };
    const emailTo = clean(form.get("email_to"));
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailTo)) return { error: "Enter the email address the invoice goes to." };
    const supabase = await createClient();
    const { data: inv, error } = await supabase
      .from("invoices")
      .insert({
        project_id: projectId,
        estimate_id: orNull(form.get("estimate_id")),
        step_id: orNull(form.get("step_id")),
        description: clean(form.get("description")) || "Progress billing",
        amount,
        email_to: emailTo,
        due_on: orNull(form.get("due_on")),
        memo: clean(form.get("memo")),
        created_by: me.id,
      })
      .select("id")
      .single();
    if (error || !inv) return { error: error?.code === "23505" ? "That payment step already has an invoice." : "Couldn't create the invoice. Try again." };
    revalidatePath(`/projects/${projectId}/invoicing`);
    revalidatePath("/office/invoicing");
    if (form.get("send") !== "1") return { ok: "Invoice saved as a draft." };
    const { pushAndSend } = await import("@/lib/invoicing");
    try {
      await pushAndSend(inv.id, me.id);
    } catch (e) {
      return { error: `Saved as a draft, but it didn't send: ${(e as Error).message}` };
    }
    revalidatePath(`/projects/${projectId}/invoicing`);
    revalidatePath("/office/invoicing");
    return { ok: `Sent. It's in QuickBooks Online and on its way to ${emailTo}.` };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function sendInvoice(invoiceId: string): Promise<Result> {
  try {
    const { me } = await requireBilling();
    const { pushAndSend } = await import("@/lib/invoicing");
    await pushAndSend(invoiceId, me.id);
    revalidatePath("/office", "layout");
    return { ok: "Sent through QuickBooks Online." };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function voidInvoice(invoiceId: string): Promise<Result> {
  try {
    await requireBilling();
    const supabase = await createClient();
    const { data } = await supabase.from("invoices").select("qbo_invoice_id, status").eq("id", invoiceId).maybeSingle();
    if (data?.qbo_invoice_id) return { error: "This invoice is in QuickBooks. Void it there; its status updates here." };
    const { error } = await supabase.from("invoices").update({ status: "void" }).eq("id", invoiceId).eq("status", "draft");
    if (error) return { error: "Couldn't void it. Try again." };
    revalidatePath("/office", "layout");
    return { ok: "Draft invoice voided." };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function checkPaymentsNow(): Promise<Result> {
  try {
    await requireOffice();
    const { checkPayments } = await import("@/lib/invoicing");
    const n = await checkPayments();
    revalidatePath("/office", "layout");
    return { ok: n ? `${n} payment${n === 1 ? "" : "s"} updated from QuickBooks.` : "No new payments in QuickBooks." };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function disconnectQuickBooks(): Promise<Result> {
  try {
    await requireBilling();
    const { disconnect } = await import("@/lib/qbo");
    await disconnect();
    revalidatePath("/office/invoicing");
    return { ok: "QuickBooks disconnected." };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function runDocumentImport(): Promise<Result & { remaining?: number; done?: number; skipped?: string[] }> {
  try {
    const { me } = await requireOffice();
    if (me.role !== "owner" && me.role !== "admin") return { error: "Only the Owner or Admin can run the import." };
    const { importDocuments } = await import("@/lib/jobtread-import");
    const r = await importDocuments(15);
    revalidatePath("/", "layout");
    return { ok: "ok", ...r };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function runInvoiceImport(): Promise<Result & { remaining?: number; done?: number; skipped?: string[]; linked?: number; replaced?: number }> {
  try {
    const { me } = await requireOffice();
    if (me.role !== "owner" && me.role !== "admin") return { error: "Only the Owner or Admin can run the import." };
    const { importInvoices } = await import("@/lib/jobtread-import");
    const r = await importInvoices(40);
    revalidatePath("/", "layout");
    return { ok: "ok", ...r };
  } catch (e) {
    return { error: (e as Error).message };
  }
}
