import DocumentsTable, { docFilter, type DocRow } from "@/components/DocumentsTable";
import type { ClientCopy } from "@/lib/client-copy";
import { docNumber, docPrice, itemQty, loadDocPrices, STATUS_LABEL, totals } from "@/lib/estimates";
import { usd } from "@/lib/office";
import { createClient } from "@/lib/supabase/server";
import { jobMeasures } from "./load";
import NewDocumentMenu from "./NewDocumentMenu";
import type { BudgetPick } from "./NewEstimate";

export const metadata = { title: "Documents · Beshara OnSite" };

export default async function DocumentsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ show?: string; new?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const filter = docFilter(sp.show);
  const supabase = await createClient();
  const [{ data: job }, { data: ests }, { data: items }, { data: docTemplates }, measures] = await Promise.all([
    supabase.from("projects").select("job_number").eq("id", id).maybeSingle(),
    supabase.from("estimates").select("id, seq, kind, name, status, issued_on, signed_at, client_copy").eq("project_id", id).order("seq"),
    supabase.from("estimate_items").select("estimate_id, quantity, unit_cost, unit_price, measurement_id, qty_factor, waste_pct, estimates!inner(project_id)").eq("estimates.project_id", id),
    supabase.from("document_templates").select("id, name, kind, intro").eq("archived", false).order("position"),
    jobMeasures(supabase, id),
  ]);
  const sum = (eid: string) =>
    totals(((items ?? []) as { estimate_id: string; quantity: number; unit_cost: number; unit_price: number; measurement_id: string | null; qty_factor: number; waste_pct: number }[])
      .filter((i) => i.estimate_id === eid)
      .map((i) => ({ q: itemQty(i, measures.map), c: Number(i.unit_cost), p: Number(i.unit_price) })));
  // The job budget, with the documents each line is on, for "New document".
  const [{ data: bgs }, { data: bis }, { data: links }] = await Promise.all([
    supabase.from("budget_groups").select("id, name").eq("project_id", id).order("position"),
    supabase.from("budget_items").select("id, group_id, name, quantity, unit_price, measurement_id, qty_factor, waste_pct").eq("project_id", id).order("position"),
    supabase.from("estimate_items").select("budget_item_id, estimate_id").not("budget_item_id", "is", null).in("estimate_id", (ests ?? []).map((e) => e.id)),
  ]);
  const estById = new Map((ests ?? []).map((e) => [e.id, e]));
  const budget: BudgetPick[] = (bgs ?? []).map((g) => ({
    id: g.id,
    name: g.name,
    items: (bis ?? []).filter((i) => i.group_id === g.id).map((i) => {
      const docs = [...new Set((links ?? []).filter((l) => l.budget_item_id === i.id).map((l) => l.estimate_id))]
        .map((eid) => estById.get(eid)).filter((e): e is NonNullable<typeof e> => !!e && e.status !== "denied")
        .map((e) => ({ label: `${e.kind} ${docNumber(job?.job_number ?? null, e.seq)} · ${STATUS_LABEL[e.status]}`, status: e.status }));
      return { id: i.id, name: i.name, price: itemQty(i, measures.map) * Number(i.unit_price), docs };
    }),
  }));
  const prices = await loadDocPrices(supabase, (ests ?? []).map((e) => e.id));
  // Signed documents show what the client signed; the rest, the current estimate.
  const rows: DocRow[] = (ests ?? []).map((e) => {
    const t = sum(e.id);
    const price = e.status === "approved" && e.client_copy ? (e.client_copy as ClientCopy).total : docPrice(prices.get(e.id), t.price);
    return { id: e.id, seq: e.seq, project_id: id, job_number: job?.job_number ?? null, kind: e.kind, name: e.name, status: e.status, issued_on: e.issued_on, signed_at: e.signed_at, cost: t.cost, price };
  });
  const signed = rows.filter((r) => r.status === "approved").reduce((s, r) => s + r.price, 0);
  return (
    <div className="page">
      <div className="otools" style={{ justifyContent: "space-between" }}>
        <p className="fine">Contract (signed): <b style={{ color: "var(--ink)" }}>{usd(signed)}</b></p>
        <NewDocumentMenu startOpen={sp.new === "1"} projectId={id} budget={budget} docTemplates={(docTemplates ?? []).map((t) => ({ id: t.id, name: t.name, kind: t.kind, intro: t.intro.slice(0, 160) }))} hasProposal={(ests ?? []).some((e) => e.kind === "Proposal")} />
      </div>
      <DocumentsTable rows={rows} filter={filter} href={(f) => `/projects/${id}/estimates${f === "all" ? "" : `?show=${f}`}`} showJob={false} />
    </div>
  );
}
