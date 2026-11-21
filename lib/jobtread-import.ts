import "server-only";
import { pave } from "./jobtread";
import { createAdminClient } from "./supabase/admin";

// One-time (and safely repeatable) copy of Beshara's JobTread data into
// OnSite: the catalog, customers and contacts, and jobs with their status.
// Records keep their JobTread ID, so running it again updates instead of
// duplicating.
//
// JobTread couldn't bill a percentage payment plan, so many jobs have a twin
// "Internal - Invoices" job (same customer and location) that held the
// payment schedule and invoices. Those twins aren't imported as jobs: each is
// attached to its real job (jobtread_invoice_job_ids) so its payment schedule
// and invoices can come across with the job later.

const UNIT_ABBR: Record<string, string> = {
  "Lump Sum": "LS", "Square Feet": "SF", "Linear Feet": "LF", Each: "EA", Hours: "HR",
  "Cubic Yards": "CY", Days: "DAY", Gallons: "GAL", Pounds: "LB", Squares: "SQ",
};
const INVOICE_STATUSES = ["Internal - Invoices", "Internal - Invoices Complete Payment"];
const STATUS_MAP: Record<string, string> = {
  "New Lead": "New Lead", Estimating: "Estimating", "On Hold": "On Hold", "Closed Lost": "Closed Lost",
  Approved: "Approved", Preconstruction: "Preconstruction", Permitting: "Permitting", Construction: "Construction",
  Complete: "Complete", "Preconstruction Services Complete": "Complete",
};

type Page<T> = { nodes: T[]; nextPage: string | null };

async function all<T>(path: (page: string | null) => Record<string, unknown>, pick: (r: Record<string, unknown>) => Page<T>): Promise<T[]> {
  const out: T[] = [];
  let page: string | null = null;
  for (let i = 0; i < 50; i++) {
    const r = await pave<Record<string, unknown>>(path(page));
    const p = pick(r);
    out.push(...p.nodes);
    if (!p.nextPage) break;
    page = p.nextPage;
  }
  return out;
}

async function orgId() {
  if (process.env.JOBTREAD_ORG_ID) return process.env.JOBTREAD_ORG_ID;
  const r = await pave<{ currentGrant: { organization: { id: string } | null; user: { memberships: { nodes: { organization: { id: string } | null }[] } } | null } }>({
    currentGrant: { organization: { id: {} }, user: { memberships: { nodes: { organization: { id: {} } } } } },
  });
  const id = r.currentGrant.organization?.id ?? r.currentGrant.user?.memberships.nodes.find((m) => m.organization)?.organization?.id;
  if (!id) throw new Error("This JobTread key isn't connected to a company.");
  return id;
}

type JTGroup = { id: string; name: string; description: string | null; parentCostGroup: { id: string } | null };
type JTItem = { id: string; name: string; description: string | null; quantity: number | null; unitCost: number | null; unitPrice: number | null; costType: { name: string } | null; unit: { name: string } | null; costGroup: { id: string } | null };
type JTCF = { nodes: { value: unknown; customField: { name: string } }[] };
type JTAccount = { id: string; name: string; contacts: { nodes: { id: string; name: string; title: string | null; customFieldValues: JTCF }[] }; locations: { nodes: { id: string; address: string | null }[] } };
type JTJob = { id: string; name: string; number: string; closedOn: string | null; createdAt: string; location: { id: string; name: string; address: string | null; account: { id: string; name: string } | null } | null; customFieldValues: JTCF };

const cf = (v: JTCF | undefined, name: string) => {
  const x = v?.nodes.find((n) => n.customField.name === name)?.value;
  return x == null || x === "" ? null : String(x);
};
const townOf = (address: string | null | undefined) => address?.split(",").slice(-3, -2)[0]?.trim() ?? "";

export type ImportPlan = {
  catalog: { groups: number; items: number; newGroups: number; newItems: number };
  customers: { total: number; new: number; contacts: number };
  jobs: { total: number; new: number; updated: number; byStatus: Record<string, number> };
  merges: { invoiceJob: string; realJob: string | null; customer: string; note?: string }[];
};

async function fetchAll() {
  const org = await orgId();
  const o = (inner: Record<string, unknown>) => ({ organization: { $: { id: org }, ...inner } });
  const pick = (key: string) => (r: Record<string, unknown>) => (r.organization as Record<string, Page<never>>)[key];
  const [groups, items, accounts, jobs] = await Promise.all([
    all<JTGroup>((page) => o({ costGroups: { $: { size: 100, where: [["job", "id"], null], ...(page ? { page } : {}) }, nodes: { id: {}, name: {}, description: {}, parentCostGroup: { id: {} } }, nextPage: {} } }), pick("costGroups")),
    all<JTItem>((page) => o({ costItems: { $: { size: 100, where: [["job", "id"], null], ...(page ? { page } : {}) }, nodes: { id: {}, name: {}, description: {}, quantity: {}, unitCost: {}, unitPrice: {}, costType: { name: {} }, unit: { name: {} }, costGroup: { id: {} } }, nextPage: {} } }), pick("costItems")),
    all<JTAccount>((page) => o({ accounts: { $: { size: 50, where: ["type", "customer"], ...(page ? { page } : {}) }, nodes: { id: {}, name: {}, contacts: { $: { size: 10 }, nodes: { id: {}, name: {}, title: {}, customFieldValues: { $: { size: 5 }, nodes: { value: {}, customField: { name: {} } } } } }, locations: { $: { size: 5 }, nodes: { id: {}, address: {} } } }, nextPage: {} } }), pick("accounts")),
    all<JTJob>((page) => o({ jobs: { $: { size: 100, ...(page ? { page } : {}) }, nodes: { id: {}, name: {}, number: {}, closedOn: {}, createdAt: {}, location: { id: {}, name: {}, address: {}, account: { id: {}, name: {} } }, customFieldValues: { $: { size: 5 }, nodes: { value: {}, customField: { name: {} } } } }, nextPage: {} } }), pick("jobs")),
  ]);
  return { groups, items, accounts, jobs };
}

// Pairs each "Internal - Invoices" job with the real job it bills for: same
// customer, ideally the same location, not itself an invoice job; the most
// recent such job that isn't a lost lead wins.
function matchInvoiceJobs(jobs: JTJob[]) {
  const status = (j: JTJob) => cf(j.customFieldValues, "Status") ?? "";
  const real = jobs.filter((j) => !INVOICE_STATUSES.includes(status(j)));
  const out = new Map<string, { real: JTJob | null; note?: string }>();
  for (const inv of jobs.filter((j) => INVOICE_STATUSES.includes(status(j)))) {
    const acct = inv.location?.account?.id;
    const sameAcct = real.filter((j) => acct && j.location?.account?.id === acct);
    const sameLoc = sameAcct.filter((j) => j.location?.id === inv.location?.id);
    const pool = (sameLoc.length ? sameLoc : sameAcct).filter((j) => !["Closed Lost", "New Lead"].includes(status(j)));
    const pick = [...pool].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
    out.set(inv.id, {
      real: pick,
      note: !pick ? "No matching job found; its invoices will be kept for review." : pool.length > 1 ? `${pool.length} possible jobs; picked the newest. Check it.` : undefined,
    });
  }
  return out;
}

export async function planImport(): Promise<ImportPlan> {
  const data = await fetchAll();
  const db = createAdminClient();
  const [g, i, c, p] = await Promise.all([
    db.from("cost_groups").select("jobtread_id").not("jobtread_id", "is", null),
    db.from("cost_items").select("jobtread_id").not("jobtread_id", "is", null),
    db.from("customers").select("jobtread_account_id").not("jobtread_account_id", "is", null),
    db.from("projects").select("jobtread_job_id").not("jobtread_job_id", "is", null),
  ]);
  const has = (rows: Record<string, unknown>[] | null, k: string) => new Set((rows ?? []).map((r) => String(r[k])));
  const gs = has(g.data, "jobtread_id"), is = has(i.data, "jobtread_id"), cs = has(c.data, "jobtread_account_id"), ps = has(p.data, "jobtread_job_id");
  const matches = matchInvoiceJobs(data.jobs);
  const jobs = data.jobs.filter((j) => !matches.has(j.id));
  const byStatus: Record<string, number> = {};
  for (const j of jobs) {
    const s = STATUS_MAP[cf(j.customFieldValues, "Status") ?? ""] ?? (j.closedOn ? "Complete" : "New Lead");
    byStatus[s] = (byStatus[s] ?? 0) + 1;
  }
  const label = (j: JTJob) => `${j.number} · ${j.location?.account?.name ?? j.name}`;
  return {
    catalog: { groups: data.groups.length, items: data.items.length, newGroups: data.groups.filter((x) => !gs.has(x.id)).length, newItems: data.items.filter((x) => !is.has(x.id)).length },
    customers: { total: data.accounts.length, new: data.accounts.filter((a) => !cs.has(a.id)).length, contacts: data.accounts.reduce((s, a) => s + a.contacts.nodes.length, 0) },
    jobs: { total: jobs.length, new: jobs.filter((j) => !ps.has(j.id)).length, updated: jobs.filter((j) => ps.has(j.id)).length, byStatus },
    merges: data.jobs
      .filter((j) => matches.has(j.id))
      .map((j) => ({ invoiceJob: label(j), realJob: matches.get(j.id)!.real ? label(matches.get(j.id)!.real!) : null, customer: j.location?.account?.name ?? "", note: matches.get(j.id)!.note })),
  };
}

export type ImportResult = { catalog: number; customers: number; contacts: number; jobsCreated: number; jobsUpdated: number; merged: number };

export async function runImport(byUserId: string): Promise<ImportResult> {
  const data = await fetchAll();
  const db = createAdminClient();
  const check = <T>(r: { data: T; error: { message: string } | null }, what: string) => {
    if (r.error) throw new Error(`Couldn't import ${what}: ${r.error.message}`);
    return r.data;
  };

  // Cost types and units, by name.
  const typeNames = [...new Set(data.items.map((x) => x.costType?.name).filter(Boolean))] as string[];
  const unitNames = [...new Set(data.items.map((x) => x.unit?.name).filter(Boolean))] as string[];
  if (typeNames.length) check(await db.from("cost_types").upsert(typeNames.map((name) => ({ name })), { onConflict: "name", ignoreDuplicates: true }), "cost types");
  if (unitNames.length) check(await db.from("units").upsert(unitNames.map((name) => ({ name, abbr: UNIT_ABBR[name] ?? name.slice(0, 3).toUpperCase() })), { onConflict: "name", ignoreDuplicates: true }), "units");
  const types = new Map((check(await db.from("cost_types").select("id, name"), "cost types") ?? []).map((t) => [t.name as string, t.id as number]));
  const units = new Map((check(await db.from("units").select("id, name"), "units") ?? []).map((u) => [u.name as string, u.id as number]));

  // Cost groups: parents first, then link parent_id.
  check(await db.from("cost_groups").upsert(data.groups.map((x, n) => ({ jobtread_id: x.id, name: x.name.slice(0, 120), description: x.description ?? "", position: n })), { onConflict: "jobtread_id" }), "cost groups");
  const groupIds = new Map((check(await db.from("cost_groups").select("id, jobtread_id").not("jobtread_id", "is", null), "cost groups") ?? []).map((r) => [r.jobtread_id as string, r.id as string]));
  for (const x of data.groups.filter((x) => x.parentCostGroup)) {
    check(await db.from("cost_groups").update({ parent_id: groupIds.get(x.parentCostGroup!.id) ?? null }).eq("jobtread_id", x.id), "cost groups");
  }
  check(await db.from("cost_items").upsert(data.items.map((x, n) => ({
    jobtread_id: x.id,
    name: x.name.slice(0, 200),
    description: x.description ?? "",
    quantity: x.quantity,
    unit_cost: x.unitCost,
    unit_price: x.unitPrice,
    cost_type_id: x.costType ? types.get(x.costType.name) ?? null : null,
    unit_id: x.unit ? units.get(x.unit.name) ?? null : null,
    cost_group_id: x.costGroup ? groupIds.get(x.costGroup.id) ?? null : null,
    position: n,
  })), { onConflict: "jobtread_id" }), "cost items");

  // Customers and contacts.
  check(await db.from("customers").upsert(data.accounts.map((a) => ({ jobtread_account_id: a.id, name: a.name.slice(0, 160) || "Unnamed customer", address: a.locations.nodes[0]?.address ?? null })), { onConflict: "jobtread_account_id" }), "customers");
  const customerIds = new Map((check(await db.from("customers").select("id, jobtread_account_id").not("jobtread_account_id", "is", null), "customers") ?? []).map((r) => [r.jobtread_account_id as string, r.id as string]));
  const contacts = data.accounts.flatMap((a) =>
    a.contacts.nodes.map((c, n) => ({
      jobtread_contact_id: c.id,
      customer_id: customerIds.get(a.id)!,
      name: c.name.slice(0, 160) || "Contact",
      title: c.title,
      email: cf(c.customFieldValues, "Email"),
      phone: cf(c.customFieldValues, "Phone"),
      is_primary: n === 0,
    })),
  );
  if (contacts.length) check(await db.from("customer_contacts").upsert(contacts, { onConflict: "jobtread_contact_id" }), "contacts");

  // Jobs. Projects already linked to a JobTread job keep their OnSite name.
  const matches = matchInvoiceJobs(data.jobs);
  const twins = new Map<string, string[]>();
  for (const [inv, m] of matches) if (m.real) twins.set(m.real.id, [...(twins.get(m.real.id) ?? []), inv]);
  const existing = new Map((check(await db.from("projects").select("id, jobtread_job_id, job_number").not("jobtread_job_id", "is", null), "projects") ?? []).map((r) => [r.jobtread_job_id as string, r]));
  const takenNumbers = new Set((check(await db.from("projects").select("job_number").not("job_number", "is", null), "projects") ?? []).map((r) => String(r.job_number)));
  let jobsCreated = 0, jobsUpdated = 0;
  for (const j of data.jobs.filter((j) => !matches.has(j.id))) {
    const status = STATUS_MAP[cf(j.customFieldValues, "Status") ?? ""] ?? (j.closedOn ? "Complete" : "New Lead");
    const fields = {
      status,
      customer_id: j.location?.account ? customerIds.get(j.location.account.id) ?? null : null,
      job_type: cf(j.customFieldValues, "Job Type"),
      notes: cf(j.customFieldValues, "Notes"),
      address: j.location?.address ?? null,
      jobtread_invoice_job_ids: twins.get(j.id) ?? [],
    };
    const prev = existing.get(j.id);
    if (prev) {
      const number = prev.job_number ?? (takenNumbers.has(j.number) ? null : j.number);
      check(await db.from("projects").update({ ...fields, job_number: number }).eq("id", prev.id), `job ${j.number}`);
      jobsUpdated++;
    } else {
      const who = j.location?.account?.name;
      const name = (/^Job \d+$/.test(j.name) || !j.name ? who || j.location?.name || j.name : j.name).slice(0, 120);
      check(await db.from("projects").insert({
        ...fields,
        name,
        town: townOf(j.location?.address),
        job_number: takenNumbers.has(j.number) ? null : j.number,
        jobtread_job_id: j.id,
        jobtread_label: [j.number, who].filter(Boolean).join(" · "),
        created_by: byUserId,
        created_at: j.createdAt,
      }), `job ${j.number}`);
      takenNumbers.add(j.number);
      jobsCreated++;
    }
  }
  return { catalog: data.groups.length + data.items.length, customers: data.accounts.length, contacts: contacts.length, jobsCreated, jobsUpdated, merged: [...matches.values()].filter((m) => m.real).length };
}
