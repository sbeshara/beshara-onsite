import DocumentsTable, { docFilter, type DocRow } from "@/components/DocumentsTable";
import type { ClientCopy } from "@/lib/client-copy";
import { itemQty, totals } from "@/lib/estimates";
import { usd } from "@/lib/office";
import { createClient } from "@/lib/supabase/server";
import { jobMeasures } from "./load";
import NewDocumentMenu from "./NewDocumentMenu";

export const metadata = { title: "Documents · Beshara OnSite" };

export default async function DocumentsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ show?: string }> }) {
  const { id } = await params;
  const filter = docFilter((await searchParams).show);
  const supabase = await createClient();
  const [{ data: job }, { data: ests }, { data: items }, { data: groups }, { data: catItems }, { data: docTemplates }, measures] = await Promise.all([
    supabase.from("projects").select("job_number").eq("id", id).maybeSingle(),
    supabase.from("estimates").select("id, seq, kind, name, status, issued_on, signed_at, client_copy").eq("project_id", id).order("seq"),
    supabase.from("estimate_items").select("estimate_id, quantity, unit_cost, unit_price, measurement_id, qty_factor, waste_pct, estimates!inner(project_id)").eq("estimates.project_id", id),
    supabase.from("cost_groups").select("id, name, parent_id").eq("archived", false).order("position"),
    supabase.from("cost_items").select("cost_group_id").eq("archived", false),
    supabase.from("document_templates").select("id, name, kind, intro").eq("archived", false).order("position"),
    jobMeasures(supabase, id),
  ]);
  const sum = (eid: string) =>
    totals(((items ?? []) as { estimate_id: string; quantity: number; unit_cost: number; unit_price: number; measurement_id: string | null; qty_factor: number; waste_pct: number }[])
      .filter((i) => i.estimate_id === eid)
      .map((i) => ({ q: itemQty(i, measures.map), c: Number(i.unit_cost), p: Number(i.unit_price) })));
  // Budget templates: catalog groups that hold other groups (e.g. "Interior Fit Out").
  const all = groups ?? [];
  const templates = all
    .filter((g) => all.some((c) => c.parent_id === g.id))
    .map((g) => {
      const kids = all.filter((c) => c.parent_id === g.id);
      return { id: g.id, name: g.name, groups: kids.map((k) => k.name), items: (catItems ?? []).filter((i) => kids.some((k) => k.id === i.cost_group_id)).length };
    });
  // Signed documents show what the client signed; the rest, the current estimate.
  const rows: DocRow[] = (ests ?? []).map((e) => {
    const t = sum(e.id);
    const price = e.status === "approved" && e.client_copy ? (e.client_copy as ClientCopy).total : t.price;
    return { id: e.id, seq: e.seq, project_id: id, job_number: job?.job_number ?? null, kind: e.kind, name: e.name, status: e.status, issued_on: e.issued_on, signed_at: e.signed_at, cost: t.cost, price };
  });
  const signed = rows.filter((r) => r.status === "approved").reduce((s, r) => s + r.price, 0);
  return (
    <div className="page">
      <div className="otools" style={{ justifyContent: "space-between" }}>
        <p className="fine">Contract (signed): <b style={{ color: "var(--ink)" }}>{usd(signed)}</b></p>
        <NewDocumentMenu projectId={id} templates={templates} docTemplates={(docTemplates ?? []).map((t) => ({ id: t.id, name: t.name, kind: t.kind, intro: t.intro.slice(0, 160) }))} hasProposal={(ests ?? []).some((e) => e.kind === "Proposal")} />
      </div>
      <DocumentsTable rows={rows} filter={filter} href={(f) => `/projects/${id}/estimates${f === "all" ? "" : `?show=${f}`}`} showJob={false} />
    </div>
  );
}
