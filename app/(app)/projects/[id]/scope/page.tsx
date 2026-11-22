import { redirect } from "next/navigation";
import { getAccess } from "@/lib/access";
import { docNumber, STATUS_LABEL } from "@/lib/estimates";
import { projectViewer } from "@/lib/viewas";
import { createClient } from "@/lib/supabase/server";
import { fmtQty, linkedQuantity, measurementValue, type Measurement, type SheetScale } from "@/lib/takeoff";
import { isTeamRole } from "@/lib/types";

export const metadata = { title: "Scope · Beshara OnSite" };

type Scope = {
  id: string; seq: number; kind: string; name: string; status: string; signed_at: string | null;
  groups: { id: string; name: string; description: string; items: { name: string; description: string; quantity: number; unit: string | null; measurement_id: string | null; qty_factor: number; waste_pct: number }[] }[];
}[];

// PMs: each sent or signed proposal's scope, without any dollar amounts.
export default async function ScopePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { me, seesNumbers } = await getAccess();
  const v = await projectViewer(id);
  if (!isTeamRole(me.role) || v.clientOnly) redirect(`/projects/${id}`);
  if (seesNumbers && !v.readOnly) redirect(`/projects/${id}/estimates`);
  const supabase = await createClient();
  const [{ data }, { data: job }, { data: ms }, { data: sheets }] = await Promise.all([
    supabase.rpc("estimate_scope", { p_project: id }),
    supabase.from("projects").select("job_number").eq("id", id).maybeSingle(),
    supabase.from("takeoff_measurements").select("id, sheet_id, kind, points").eq("project_id", id),
    supabase.from("plan_sheets").select("id, scale_in_per_ft, points_per_foot").eq("project_id", id),
  ]);
  const scale = new Map((sheets ?? []).map((s) => [s.id as string, s as SheetScale]));
  const value = new Map(((ms ?? []) as Measurement[]).map((m) => [m.id, measurementValue(m, scale.get(m.sheet_id))]));
  const docs = (data ?? []) as Scope;
  return (
    <div className="page">
      <div className="page-h">
        <h1>Scope</h1>
        <p>What&apos;s in each proposal and change order the client has been sent: the groups, descriptions, items and quantities.</p>
      </div>
      {docs.length ? docs.map((d) => (
        <article key={d.id} className="paper" style={{ margin: 0, maxWidth: 900 }}>
          <div className="sec-h"><h2 style={{ margin: 0 }}>{d.name}</h2><span>{d.kind} {docNumber(job?.job_number, d.seq)} · {STATUS_LABEL[d.status]}</span></div>
          {d.groups.map((g) => (
            <section key={g.id} className="pblock">
              <div className="pblock-h"><h3>{g.name}</h3></div>
              {g.description && <p className="pdesc">{g.description}</p>}
              {g.items.length > 0 && (
                <div className="otable-wrap">
                  <table className="pitems">
                    <thead><tr><th>Item</th><th className="r">Quantity</th></tr></thead>
                    <tbody>
                      {g.items.map((it, i) => {
                        const q = it.measurement_id && value.has(it.measurement_id) ? linkedQuantity(value.get(it.measurement_id) ?? null, Number(it.qty_factor), Number(it.waste_pct)) : Number(it.quantity);
                        return <tr key={i}><td><b>{it.name}</b>{it.description && <small>{it.description}</small>}</td><td className="r">{it.unit === "LS" ? "Lump sum" : fmtQty(q, it.unit ?? undefined)}</td></tr>;
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          ))}
        </article>
      )) : <p className="empty">No proposals have been sent for this job yet.</p>}
    </div>
  );
}
