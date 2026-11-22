import Link from "next/link";
import { docNumber, itemQty, STATUS_LABEL, totals } from "@/lib/estimates";
import { usd } from "@/lib/office";
import { createClient } from "@/lib/supabase/server";
import { jobMeasures } from "./load";
import NewEstimate from "./NewEstimate";

export const metadata = { title: "Estimates · Beshara OnSite" };

export default async function EstimatesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const [{ data: job }, { data: ests }, { data: items }, { data: groups }, { data: catItems }, { data: docTemplates }, measures] = await Promise.all([
    supabase.from("projects").select("job_number").eq("id", id).maybeSingle(),
    supabase.from("estimates").select("id, seq, kind, name, status, issued_on, signed_at").eq("project_id", id).order("seq"),
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
  const signed = (ests ?? []).filter((e) => e.status === "approved").reduce((s, e) => s + sum(e.id).price, 0);
  return (
    <div className="page">
      <div className="otools" style={{ justifyContent: "space-between" }}>
        <p className="fine">Contract (signed): <b style={{ color: "var(--ink)" }}>{usd(signed)}</b></p>
      </div>
      <div className="box otable-wrap">
        {ests?.length ? (
          <table className="otable">
            <thead><tr><th>Document</th><th>Status</th><th>Issued</th><th className="r">Cost</th><th className="r">Price</th><th className="r">Margin</th></tr></thead>
            <tbody>
              {ests.map((e) => {
                const t = sum(e.id);
                return (
                  <tr key={e.id}>
                    <td><Link className="rowlink" href={`/projects/${id}/estimates/${e.id}`}>{e.name}</Link><small>{e.kind} {docNumber(job?.job_number, e.seq)}</small></td>
                    <td><span className="pill">{STATUS_LABEL[e.status]}</span></td>
                    <td>{new Date(e.issued_on + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</td>
                    <td className="r">{usd(t.cost)}</td>
                    <td className="r"><b>{usd(t.price)}</b></td>
                    <td className={`r ${t.margin < 25 ? "margin-lo" : ""}`}>{t.price ? `${t.margin.toFixed(1)}%` : ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <p className="empty">No estimates yet. Start a proposal below.</p>
        )}
      </div>
      <section className="ocard" id="new">
        <h2>New estimate</h2>
        <NewEstimate projectId={id} templates={templates} docTemplates={(docTemplates ?? []).map((t) => ({ id: t.id, name: t.name, kind: t.kind, intro: t.intro.slice(0, 160) }))} hasProposal={(ests ?? []).some((e) => e.kind === "Proposal")} />
      </section>
    </div>
  );
}
