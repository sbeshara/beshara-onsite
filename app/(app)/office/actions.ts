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
  redirect(`/office/jobs/${id}`);
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
