import DocumentsTable, { docFilter, type DocRow } from "@/components/DocumentsTable";
import type { ClientCopy } from "@/lib/client-copy";
import { DOC_PRICE_FIELDS, docPrice, type DocPrice } from "@/lib/estimates";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Documents · Beshara OnSite" };

// Every proposal, change order and additional scope across all jobs.
export default async function AllDocuments({ searchParams }: { searchParams: Promise<{ show?: string; kind?: string }> }) {
  const sp = await searchParams;
  const filter = docFilter(sp.show);
  const kind = ["Proposal", "Change Order", "Additional Scope"].includes(sp.kind ?? "") ? sp.kind! : null;
  const supabase = await createClient();
  let q = supabase.from("estimates").select("id, seq, project_id, kind, name, status, issued_on, signed_at, client_copy, projects(job_number, name)").order("issued_on", { ascending: false }).limit(2000);
  if (kind) q = q.eq("kind", kind);
  const [{ data: ests }, { data: items }, { data: priceRows }] = await Promise.all([
    q,
    supabase.from("estimate_items").select("estimate_id, quantity, unit_cost, unit_price").limit(20000),
    supabase.from("estimates").select(`id, ${DOC_PRICE_FIELDS}`).neq("price_mode", "items").limit(2000), // fails quietly before the update
  ]);
  const prices = new Map(((priceRows ?? []) as unknown as (DocPrice & { id: string })[]).map((r) => [r.id, r]));
  const sums = new Map<string, { cost: number; price: number }>();
  for (const i of items ?? []) {
    const s = sums.get(i.estimate_id) ?? { cost: 0, price: 0 };
    s.cost += Number(i.quantity) * Number(i.unit_cost);
    s.price += Number(i.quantity) * Number(i.unit_price);
    sums.set(i.estimate_id, s);
  }
  const rows: DocRow[] = (ests ?? []).map((e) => {
    const job = e.projects as unknown as { job_number: string | null; name: string } | null;
    const s = sums.get(e.id) ?? { cost: 0, price: 0 };
    return {
      id: e.id, seq: e.seq, project_id: e.project_id, job_number: job?.job_number ?? null, job_name: job?.name, kind: e.kind, name: e.name, status: e.status,
      issued_on: e.issued_on, signed_at: e.signed_at, cost: s.cost, price: e.status === "approved" && e.client_copy ? (e.client_copy as ClientCopy).total : docPrice(prices.get(e.id), s.price),
    };
  });
  const href = (f: string, k = kind) => `/office/documents?${new URLSearchParams({ ...(f !== "all" ? { show: f } : {}), ...(k ? { kind: k } : {}) })}`;
  return (
    <div className="page">
      <div className="page-h">
        <h1>Documents</h1>
        <p>Every proposal, change order and additional scope, on every job. Open one to edit it, send it or see the signature.</p>
      </div>
      <div className="chips" role="group" aria-label="Type">
        {[null, "Proposal", "Change Order", "Additional Scope"].map((k) => (
          <a key={k ?? "all"} className="chip" href={href(filter, k)} aria-pressed={k === kind}>{k ? `${k}s` : "All types"}</a>
        ))}
      </div>
      <DocumentsTable rows={rows} filter={filter} href={(f) => href(f)} showJob />
    </div>
  );
}
