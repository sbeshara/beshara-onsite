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
type JTAccount = { id: string; name: string; locations: { nodes: { id: string; address: string | null }[] } };
type JTContact = { id: string; name: string; title: string | null; account: { id: string } | null; customFieldValues: JTCF };
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
  // JobTread refuses requests whose nested page sizes multiply out too large
  // ("Request Entity Too Large"), so contacts load on their own rather than
  // inside each customer.
  const [groups, items, accounts, contacts, jobs] = await Promise.all([
    all<JTGroup>((page) => o({ costGroups: { $: { size: 100, where: [["job", "id"], null], ...(page ? { page } : {}) }, nodes: { id: {}, name: {}, description: {}, parentCostGroup: { id: {} } }, nextPage: {} } }), pick("costGroups")),
    all<JTItem>((page) => o({ costItems: { $: { size: 100, where: [["job", "id"], null], ...(page ? { page } : {}) }, nodes: { id: {}, name: {}, description: {}, quantity: {}, unitCost: {}, unitPrice: {}, costType: { name: {} }, unit: { name: {} }, costGroup: { id: {} } }, nextPage: {} } }), pick("costItems")),
    all<JTAccount>((page) => o({ accounts: { $: { size: 100, where: ["type", "customer"], ...(page ? { page } : {}) }, nodes: { id: {}, name: {}, locations: { $: { size: 1 }, nodes: { id: {}, address: {} } } }, nextPage: {} } }), pick("accounts")),
    all<JTContact>((page) => o({ contacts: { $: { size: 100, where: [["account", "type"], "customer"], ...(page ? { page } : {}) }, nodes: { id: {}, name: {}, title: {}, account: { id: {} }, customFieldValues: { $: { size: 4 }, nodes: { value: {}, customField: { name: {} } } } }, nextPage: {} } }), pick("contacts")),
    all<JTJob>((page) => o({ jobs: { $: { size: 100, ...(page ? { page } : {}) }, nodes: { id: {}, name: {}, number: {}, closedOn: {}, createdAt: {}, location: { id: {}, name: {}, address: {}, account: { id: {}, name: {} } }, customFieldValues: { $: { size: 5 }, nodes: { value: {}, customField: { name: {} } } } }, nextPage: {} } }), pick("jobs")),
  ]);
  return { groups, items, accounts, contacts, jobs };
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
    customers: { total: data.accounts.length, new: data.accounts.filter((a) => !cs.has(a.id)).length, contacts: data.contacts.filter((c) => c.account).length },
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
  // The first contact listed for each customer is its main contact.
  const seen = new Set<string>();
  const contacts = data.contacts
    .filter((c) => c.account && customerIds.has(c.account.id))
    .map((c) => {
      const acct = c.account!.id, first = !seen.has(acct);
      seen.add(acct);
      return {
        jobtread_contact_id: c.id,
        customer_id: customerIds.get(acct)!,
        name: c.name.slice(0, 160) || "Contact",
        title: c.title,
        email: cf(c.customFieldValues, "Email"),
        phone: cf(c.customFieldValues, "Phone"),
        is_primary: first,
      };
    });
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

// ---------------------------------------------------------------------------
// Document templates and approved / pending documents
// ---------------------------------------------------------------------------

// JobTread marks bold with single asterisks; OnSite's documents use Markdown.
export const jtMarkdown = (s: string | null | undefined) =>
  (s ?? "").replace(/(^|[^*])\*([^*\n]+?)\*(?!\*)/g, "$1**$2**").trim();

const kindOf = (name: string) => (/change order/i.test(name) ? "Change Order" : /additional scope/i.test(name) ? "Additional Scope" : "Proposal");

type JTTemplate = { id: string; name: string; type: string; description: string | null; footer: string | null; dueDays: number | null };
type JTDocGroup = { id: string; name: string; description: string | null; parentCostGroup: { id: string } | null };
type JTDocItem = { id: string; name: string; description: string | null; quantity: number | null; unitCost: number | null; unitPrice: number | null; costGroup: { id: string } | null; unit: { name: string } | null; costType: { name: string } | null };
type JTDocHead = { id: string; name: string; number: number; status: string; issueDate: string | null; signedAt: string | null; showQuantity: boolean | null; price: number | null; job: { id: string } | null };
type JTDoc = JTDocHead & { description: string | null; footer: string | null; costGroups: { nodes: JTDocGroup[] }; costItems: { nodes: JTDocItem[] } };

// JobTread limits how much one request may ask for (page size times the
// details asked of each record), so documents are listed first and each
// one's lines are fetched on their own, only for the documents being imported.
async function fetchDocs() {
  const org = await orgId();
  const o = (inner: Record<string, unknown>) => ({ organization: { $: { id: org }, ...inner } });
  const pick = (key: string) => (r: Record<string, unknown>) => (r.organization as Record<string, Page<never>>)[key];
  const [templates, docs, schedules] = await Promise.all([
    all<JTTemplate>((page) => o({ documentTemplates: { $: { size: 20, ...(page ? { page } : {}) }, nodes: { id: {}, name: {}, type: {}, description: {}, footer: {}, dueDays: {} }, nextPage: {} } }), pick("documentTemplates")),
    all<JTDocHead>((page) => o({ documents: { $: { size: 50, where: { and: [["type", "customerOrder"], ["status", "in", ["approved", "pending"]], ["name", "!=", "Payment Schedule"]] }, ...(page ? { page } : {}) },
      nodes: { id: {}, name: {}, number: {}, status: {}, issueDate: {}, signedAt: {}, showQuantity: {}, price: {}, job: { id: {} } }, nextPage: {} } }), pick("documents")),
    all<{ job: { id: string } | null; costItems: { nodes: { name: string }[] } }>((page) => o({ documents: { $: { size: 10, where: { and: [["type", "customerOrder"], ["status", "approved"], ["name", "Payment Schedule"]] }, ...(page ? { page } : {}) },
      nodes: { job: { id: {} }, costItems: { $: { size: 30 }, nodes: { name: {} } } }, nextPage: {} } }), pick("documents")),
  ]);
  return { templates: templates.filter((t) => t.type === "customerOrder" && t.name !== "Payment Schedule"), docs, schedules };
}

async function fetchDocDetail(head: JTDocHead): Promise<JTDoc> {
  const fields = (page?: string) => ({
    document: {
      $: { id: head.id }, description: {}, footer: {},
      costGroups: { $: { size: 100 }, nodes: { id: {}, name: {}, description: {}, parentCostGroup: { id: {} } } },
      costItems: { $: { size: 100, ...(page ? { page } : {}) }, nodes: { id: {}, name: {}, description: {}, quantity: {}, unitCost: {}, unitPrice: {}, costGroup: { id: {} }, unit: { name: {} }, costType: { name: {} } }, nextPage: {} },
    },
  });
  type R = { document: { description: string | null; footer: string | null; costGroups: { nodes: JTDocGroup[] }; costItems: { nodes: JTDocItem[]; nextPage: string | null } } };
  const first = (await pave<R>(fields())).document;
  const items = [...first.costItems.nodes];
  for (let page = first.costItems.nextPage, i = 0; page && i < 10; i++) {
    const more = (await pave<R>(fields(page))).document.costItems;
    items.push(...more.nodes);
    page = more.nextPage;
  }
  return { ...head, description: first.description, footer: first.footer, costGroups: first.costGroups, costItems: { nodes: items } };
}

export type DocPlan = { templates: number; approved: number; pending: number; imported: number };

export async function planDocuments(): Promise<DocPlan> {
  const { templates, docs } = await fetchDocs();
  const { data } = await createAdminClient().from("estimates").select("jobtread_document_id").not("jobtread_document_id", "is", null);
  const done = new Set((data ?? []).map((r) => r.jobtread_document_id as string));
  return { templates: templates.length, approved: docs.filter((d) => d.status === "approved").length, pending: docs.filter((d) => d.status === "pending").length, imported: docs.filter((d) => done.has(d.id)).length };
}

// Imports templates, then up to `batch` documents not imported yet. Call it
// again until `remaining` is 0 (keeps each run short).
export async function importDocuments(batch = 15): Promise<{ done: number; remaining: number; skipped: string[] }> {
  const db = createAdminClient();
  const check = <T>(r: { data: T; error: { message: string } | null }, what: string) => {
    if (r.error) throw new Error(`Couldn't import ${what}: ${r.error.message}`);
    return r.data;
  };
  const { templates, docs, schedules } = await fetchDocs();

  check(await db.from("document_templates").upsert(templates.map((t, n) => ({
    jobtread_id: t.id, name: t.name.slice(0, 120), kind: kindOf(t.name), intro: jtMarkdown(t.description), terms: jtMarkdown(t.footer), due_days: t.dueDays, position: n,
  })), { onConflict: "jobtread_id" }), "document templates");
  const tplByName = new Map((check(await db.from("document_templates").select("id, name"), "document templates") ?? []).map((t) => [t.name as string, t.id as string]));

  const [{ data: done }, { data: projects }, { data: units }, { data: types }] = await Promise.all([
    db.from("estimates").select("jobtread_document_id").not("jobtread_document_id", "is", null),
    db.from("projects").select("id, jobtread_job_id, jobtread_invoice_job_ids").not("jobtread_job_id", "is", null),
    db.from("units").select("id, name"),
    db.from("cost_types").select("id, name"),
  ]);
  const imported = new Set((done ?? []).map((r) => r.jobtread_document_id as string));
  const projectOf = new Map<string, string>();
  for (const p of projects ?? []) {
    projectOf.set(p.jobtread_job_id as string, p.id as string);
    for (const t of (p.jobtread_invoice_job_ids as string[]) ?? []) if (!projectOf.has(t)) projectOf.set(t, p.id as string);
  }
  const unitId = new Map((units ?? []).map((u) => [u.name as string, u.id as number]));
  const typeId = new Map((types ?? []).map((t) => [t.name as string, t.id as number]));

  // Each job's percentage payment plan from its JobTread "Payment Schedule"
  // (lines like "Deposit 10%"). Used for the job's main signed proposal when
  // the percentages add up to 100.
  const planFor = new Map<string, { name: string; percent: number }[]>();
  for (const s of schedules) {
    const pid = s.job ? projectOf.get(s.job.id) : undefined;
    if (!pid || planFor.has(pid)) continue;
    // Percentage lines in order; a run that adds up to 100% is one plan (some
    // schedules hold two, e.g. the build and then the cabinetry). The first is
    // the main proposal's.
    const lines = s.costItems.nodes
      .map((i) => ({ i, m: i.name.match(/(\d+(?:\.\d+)?)\s*%/) }))
      .filter((x) => x.m && Number(x.m[1]) < 100)
      .map((x) => ({ name: x.i.name.replace(/\s*\d+(?:\.\d+)?\s*%\s*/, " ").trim() || x.i.name, percent: Number(x.m![1]) }));
    let run: { name: string; percent: number }[] = [];
    for (const l of lines) {
      run.push(l);
      const sum = run.reduce((a, b) => a + b.percent, 0);
      if (Math.abs(sum - 100) < 0.5) { planFor.set(pid, run); break; }
      if (sum > 100) run = [];
    }
  }
  // The proposal that gets the job's plan: its largest approved proposal.
  const mainProposal = new Map<string, string>();
  const value = (d: JTDocHead) => Number(d.price ?? 0);
  for (const d of docs.filter((d) => d.status === "approved" && kindOf(d.name) === "Proposal")) {
    const pid = d.job ? projectOf.get(d.job.id) : undefined;
    if (!pid) continue;
    const cur = docs.find((x) => x.id === mainProposal.get(pid));
    if (!cur || value(d) > value(cur)) mainProposal.set(pid, d.id);
  }

  const { buildClientCopy } = await import("@/app/(app)/projects/[id]/(office)/estimates/load");
  // Documents whose job isn't in OnSite are reported, not retried forever.
  const mapped = (d: JTDocHead) => !!(d.job && projectOf.get(d.job.id));
  const skipped = docs.filter((d) => !mapped(d)).map((d) => `${d.name} #${d.number}`);
  const todo = docs.filter((d) => !imported.has(d.id) && mapped(d));
  let count = 0;
  for (const head of todo.slice(0, batch)) {
    const pid = projectOf.get(head.job!.id)!;
    const d = await fetchDocDetail(head);
    const kind = kindOf(d.name);
    const { data: taken } = await db.from("estimates").select("id").eq("project_id", pid).eq("seq", d.number).maybeSingle();
    const est = check(await db.from("estimates").insert({
      project_id: pid, seq: taken ? null : d.number, kind, name: d.name.slice(0, 160), status: "draft",
      intro: jtMarkdown(d.description), terms: jtMarkdown(d.footer), issued_on: d.issueDate ?? undefined,
      template_id: tplByName.get(d.name) ?? null, jobtread_document_id: d.id,
      imported_note: d.status === "approved" ? "Signed in JobTread" : "Sent from JobTread, not signed there yet",
    }).select("id").single(), `${d.name} #${d.number}`) as { id: string };
    try {

    // Groups: each JobTread group with line items becomes a group here (nested
    // groups are listed in order); items with no group go in a general group.
    const groups = d.costGroups.nodes;
    const items = d.costItems.nodes;
    const view = d.showQuantity === false ? "total" : "items";
    const buckets: { name: string; description: string; items: JTDocItem[] }[] = [];
    for (const g of groups) {
      const its = items.filter((i) => i.costGroup?.id === g.id);
      if (its.length || g.description) buckets.push({ name: g.name, description: jtMarkdown(g.description), items: its });
    }
    const loose = items.filter((i) => !i.costGroup || !groups.some((g) => g.id === i.costGroup!.id));
    if (loose.length) buckets.push({ name: kind === "Proposal" ? "Scope" : kind, description: "", items: loose });
    for (const [gi, b] of buckets.entries()) {
      const g = check(await db.from("estimate_groups").insert({ estimate_id: est.id, name: b.name.slice(0, 120), description: b.description, client_view: view, position: gi }).select("id").single(), "a group") as { id: string };
      if (b.items.length)
        check(await db.from("estimate_items").insert(b.items.map((i, n) => ({
          estimate_id: est.id, group_id: g.id, name: i.name.slice(0, 200), description: i.description ?? "",
          unit_id: i.unit ? unitId.get(i.unit.name) ?? null : unitId.get("Lump Sum") ?? null,
          cost_type_id: i.costType ? typeId.get(i.costType.name) ?? null : null,
          quantity: i.quantity ?? 1, unit_cost: i.unitCost ?? 0, unit_price: i.unitPrice ?? 0, position: n,
        }))), "line items");
    }

    const steps = kind !== "Proposal" ? [{ name: "Due on approval", percent: 100 }]
      : mainProposal.get(pid) === d.id && planFor.get(pid) ? planFor.get(pid)!
      : d.status === "approved" ? [{ name: "Per contract", percent: 100 }]
      : [{ name: "Deposit on signing", percent: 10 }, { name: "Rough-in complete", percent: 30 }, { name: "Finishes complete", percent: 50 }, { name: "Final walkthrough", percent: 10 }];
    check(await db.from("estimate_payment_steps").insert(steps.map((s, n) => ({ ...s, estimate_id: est.id, position: n }))), "payment steps");

    // Signed ones are frozen as signed, with the client's copy for invoicing.
    if (d.status === "approved") {
      const copy = await buildClientCopy(db, pid, est.id);
      check(await db.from("estimates").update({
        status: "approved", client_copy: copy, signed_at: d.signedAt ?? (d.issueDate ? `${d.issueDate}T12:00:00Z` : new Date().toISOString()),
        signed_by_name: "Signed in JobTread", sent_at: d.issueDate ? `${d.issueDate}T12:00:00Z` : null,
      }).eq("id", est.id), "signature");
    }
    } catch (e) {
      // Don't leave a half-built estimate behind: the next run tries it again.
      await db.from("estimates").delete().eq("id", est.id);
      throw e;
    }
    count++;
  }
  return { done: count, remaining: Math.max(0, todo.length - batch), skipped };
}

// ---------------------------------------------------------------------------
// Invoices and payments
// ---------------------------------------------------------------------------
// JobTread's invoices live on the real job (older ones) and on its duplicate
// "Internal - Invoices" job (newer ones); both land on the one real job here.
// They keep their QuickBooks invoice and payment IDs, so once QuickBooks is
// connected, payments keep flowing in without doubling up.

type JTInvoice = {
  id: string; name: string; number: number; price: number | null; amountPaid: number | null; issueDate: string | null; dueDate: string | null; status: string; qboId: string | null;
  job: { id: string; number: string } | null;
  costItems: { nodes: { name: string }[] };
  documentPayments: { nodes: { amount: number; payment: { id: string; paidAt: string | null; qboId: string | null; source: string | null } | null }[] };
};

async function fetchInvoices() {
  const org = await orgId();
  return all<JTInvoice>(
    (page) => ({ organization: { $: { id: org }, documents: { $: { size: 10, where: { and: [["type", "customerInvoice"], ["status", "in", ["approved", "pending"]]] }, ...(page ? { page } : {}) },
      nodes: { id: {}, name: {}, number: {}, price: {}, amountPaid: {}, issueDate: {}, dueDate: {}, status: {}, qboId: {}, job: { id: {}, number: {} },
        costItems: { $: { size: 5 }, nodes: { name: {} } },
        documentPayments: { $: { size: 5 }, nodes: { amount: {}, payment: { id: {}, paidAt: {}, qboId: {}, source: {} } } } },
      nextPage: {} } } }),
    (r) => (r.organization as Record<string, Page<JTInvoice>>).documents,
  );
}

export type InvoicePlan = { invoices: number; paid: number; total: number; imported: number };

export async function planInvoices(): Promise<InvoicePlan> {
  const invs = await fetchInvoices();
  const { data } = await createAdminClient().from("invoices").select("jobtread_document_id").not("jobtread_document_id", "is", null);
  const done = new Set((data ?? []).map((r) => r.jobtread_document_id as string));
  return {
    invoices: invs.length,
    paid: invs.reduce((s, i) => s + Number(i.amountPaid ?? 0), 0),
    total: invs.reduce((s, i) => s + Number(i.price ?? 0), 0),
    imported: invs.filter((i) => done.has(i.id)).length,
  };
}

// Paid dates in New York time (JobTread stores midnight Eastern as 04:00/05:00 UTC).
const nyDate = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/New_York" });

export async function importInvoices(batch = 40): Promise<{ done: number; remaining: number; skipped: string[]; linked: number; replaced: number }> {
  const db = createAdminClient();
  const check = <T>(r: { data: T; error: { message: string } | null }, what: string) => {
    if (r.error) throw new Error(`Couldn't import ${what}: ${r.error.message}`);
    return r.data;
  };
  const invs = await fetchInvoices();
  const [{ data: done }, { data: projects }, { data: steps }, { data: existing }] = await Promise.all([
    db.from("invoices").select("jobtread_document_id").not("jobtread_document_id", "is", null),
    db.from("projects").select("id, jobtread_job_id, jobtread_invoice_job_ids").not("jobtread_job_id", "is", null),
    db.from("estimate_payment_steps").select("id, name, percent, estimate_id, estimates!inner(project_id, status, kind, client_copy)").eq("estimates.status", "approved"),
    db.from("invoices").select("project_id, seq, step_id").neq("status", "void"),
  ]);
  const imported = new Set((done ?? []).map((r) => r.jobtread_document_id as string));
  const realJob = new Map<string, string>(), twinJob = new Map<string, string>();
  for (const p of projects ?? []) {
    realJob.set(p.jobtread_job_id as string, p.id as string);
    for (const t of (p.jobtread_invoice_job_ids as string[]) ?? []) twinJob.set(t, p.id as string);
  }
  const projectFor = (jobId: string) => realJob.get(jobId) ?? twinJob.get(jobId);
  const takenSeq = new Set((existing ?? []).map((r) => `${r.project_id}:${r.seq}`));
  const usedSteps = new Set((existing ?? []).map((r) => r.step_id as string | null).filter(Boolean) as string[]);
  type Step = { id: string; name: string; percent: number; estimate_id: string; project_id: string; kind: string; amount: number };
  const stepsByProject = new Map<string, Step[]>();
  for (const s of (steps ?? []) as unknown as { id: string; name: string; percent: number; estimate_id: string; estimates: { project_id: string; kind: string; client_copy: { total?: number } | null } }[]) {
    const pid = s.estimates.project_id;
    const amount = Math.round((s.estimates.client_copy?.total ?? 0) * Number(s.percent)) / 100;
    stepsByProject.set(pid, [...(stepsByProject.get(pid) ?? []), { id: s.id, name: s.name, percent: Number(s.percent), estimate_id: s.estimate_id, project_id: pid, kind: s.estimates.kind, amount }]);
  }
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

  const mapped = invs.filter((i) => i.job && projectFor(i.job.id) && Number(i.price ?? 0) > 0);
  const skipped = invs.filter((i) => !mapped.includes(i)).map((i) => `${i.name} ${i.job?.number ?? "?"}-${i.number}`);
  const todo = mapped.filter((i) => !imported.has(i.id));
  let count = 0, linked = 0;
  for (const i of todo.slice(0, batch)) {
    const pid = projectFor(i.job!.id)!;
    const onTwin = !realJob.has(i.job!.id);
    const seq = !onTwin && !takenSeq.has(`${pid}:${i.number}`) ? i.number : null;
    // Match a percentage line ("Permits 10%") to the signed proposal's step.
    let step: Step | undefined;
    for (const line of i.costItems.nodes) {
      const m = line.name.match(/(\d+(?:\.\d+)?)\s*%/);
      if (!m) continue;
      const pct = Number(m[1]), label = norm(line.name.replace(m[0], ""));
      step = (stepsByProject.get(pid) ?? []).find((s) => !usedSteps.has(s.id) && Math.abs(s.percent - pct) < 0.01 && (norm(s.name) === label || norm(s.name).split(" ")[0] === label.split(" ")[0]));
      if (step) break;
    }
    // Change orders and extras were billed as one line ("HVAC Change Order
    // 100%", "Glass Partitions"): match the invoice to the signed change order
    // or additional scope (or any unbilled step) with exactly the same amount.
    if (!step) {
      const amt = Math.round(Number(i.price) * 100) / 100;
      const same = (stepsByProject.get(pid) ?? []).filter((s) => !usedSteps.has(s.id) && Math.abs(s.amount - amt) < 0.02);
      step = same.find((s) => s.kind !== "Proposal") ?? (same.length === 1 ? same[0] : undefined);
    }
    const lines = i.costItems.nodes.map((n) => n.name).filter(Boolean);
    const description = `${lines.slice(0, 3).join(", ")}${lines.length > 3 ? ", …" : ""}`.slice(0, 180) + ` (JobTread ${i.job!.number}-${i.number})`;
    const inv = check(await db.from("invoices").insert({
      project_id: pid, seq, estimate_id: step?.estimate_id ?? null, step_id: step?.id ?? null,
      description, amount: Math.round(Number(i.price) * 100) / 100, status: "sent",
      issued_on: i.issueDate ?? undefined, due_on: i.dueDate, sent_at: i.issueDate ? `${i.issueDate}T12:00:00Z` : null,
      qbo_invoice_id: i.qboId, qbo_synced_at: i.qboId ? new Date().toISOString() : null, jobtread_document_id: i.id,
    }).select("id, seq").single(), `invoice ${i.job!.number}-${i.number}`) as { id: string; seq: number };
    try {
      takenSeq.add(`${pid}:${inv.seq}`);
      if (step) {
        usedSteps.add(step.id);
        linked++;
        await db.from("estimate_payment_steps").update({ reached_at: i.issueDate ? `${i.issueDate}T12:00:00Z` : new Date().toISOString() }).eq("id", step.id);
      }
      const pays = i.documentPayments.nodes.filter((p) => p.payment && Number(p.amount) !== 0);
      if (pays.length)
        check(await db.from("invoice_payments").insert(pays.map((p) => ({
          invoice_id: inv.id,
          amount: Math.round(Number(p.amount) * 100) / 100,
          paid_on: p.payment!.paidAt ? nyDate(p.payment!.paidAt) : i.issueDate ?? new Date().toISOString().slice(0, 10),
          method: p.payment!.source === "qbo" || p.payment!.qboId ? "QuickBooks" : "Recorded in JobTread",
          qbo_payment_id: p.payment!.qboId ?? `jobtread:${p.payment!.id}`,
        }))), `payments on ${i.job!.number}-${i.number}`);
    } catch (e) {
      await db.from("invoices").delete().eq("id", inv.id);
      throw e;
    }
    count++;
  }
  const remaining = Math.max(0, todo.length - batch);
  const replaced = remaining ? 0 : await reconcileReplacedInvoices();
  return { done: count, remaining, skipped, linked, replaced };
}

// On jobs that had a duplicate "Internal - Invoices" job, that job's invoices
// are the billing record: its payment schedule adds up to the signed
// documents, and older invoices made on the real job were re-entered or
// redone there. Those older real-job invoices are kept for reference but
// marked replaced (void), so nothing is counted twice. Safe to run again.
export async function reconcileReplacedInvoices() {
  const db = createAdminClient();
  const { data: projects } = await db.from("projects").select("id, job_number").not("jobtread_invoice_job_ids", "eq", "{}");
  let replaced = 0;
  for (const p of projects ?? []) {
    const { data: invs } = await db.from("invoices").select("id, issued_on, description, status").eq("project_id", p.id).not("jobtread_document_id", "is", null);
    const fromJob = (d: string) => d.match(/\(JobTread (\S+)-\d+\)/)?.[1];
    const twin = (invs ?? []).filter((i) => fromJob(i.description) && fromJob(i.description) !== p.job_number);
    if (!twin.length) continue;
    const first = twin.map((i) => i.issued_on).sort()[0];
    const old = (invs ?? []).filter((i) => fromJob(i.description) === p.job_number && i.issued_on < first && i.status !== "void");
    for (const i of old) {
      await db.from("invoices").update({ status: "void", step_id: null, description: `Replaced on the invoice job · ${i.description}`.slice(0, 400) }).eq("id", i.id);
      replaced++;
    }
  }
  return replaced;
}
