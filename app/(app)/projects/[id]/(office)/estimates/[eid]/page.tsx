import { notFound } from "next/navigation";
import { clientShow, loadDocPrices, type EstGroup, type EstItem, type EstStep } from "@/lib/estimates";
import { measurementValue } from "@/lib/takeoff";
import { createClient } from "@/lib/supabase/server";
import { jobMeasures } from "../load";
import EstimateEditor from "./EstimateEditor";

export default async function EstimatePage({ params }: { params: Promise<{ id: string; eid: string }> }) {
  const { id, eid } = await params;
  const supabase = await createClient();
  const [{ data: est }, { data: groups }, { data: items }, { data: steps }, { data: job }, { data: catGroups }, { data: catItems }, { data: types }, { data: units }, measures] = await Promise.all([
    supabase.from("estimates").select("id, seq, kind, name, status, intro, terms, issued_on, signed_at, signed_by_name, sent_at, signature, declined_at, decline_reason").eq("id", eid).eq("project_id", id).maybeSingle(),
    supabase.from("estimate_groups").select("id, name, description, client_view, display_qty, display_unit, position, budget_group_id").eq("estimate_id", eid).order("position"),
    supabase.from("estimate_items").select("id, group_id, catalog_item_id, name, description, cost_type_id, unit_id, quantity, unit_cost, unit_price, measurement_id, qty_factor, waste_pct, position").eq("estimate_id", eid).order("position"),
    supabase.from("estimate_payment_steps").select("id, name, percent, position").eq("estimate_id", eid).order("position"),
    supabase.from("projects").select("job_number").eq("id", id).maybeSingle(),
    supabase.from("cost_groups").select("id, name, parent_id, description").eq("archived", false).order("position"),
    supabase.from("cost_items").select("id, cost_group_id, name, description, cost_type_id, unit_id, quantity, unit_cost, unit_price").eq("archived", false).order("position"),
    supabase.from("cost_types").select("id, name").order("position"),
    supabase.from("units").select("id, name, abbr").order("id"),
    jobMeasures(supabase, id),
  ]);
  const { data: chats } = await supabase.from("chats").select("id, name").eq("project_id", id).eq("is_internal", false).order("position");
  if (!est) notFound();
  // Read on its own so a database without the column still opens the editor.
  const docPriceRow = (await loadDocPrices(supabase, [eid])).get(eid) ?? null;
  const { data: showRow, error: showErr } = await supabase.from("estimates").select("client_show").eq("id", eid).maybeSingle();
  return (
    <EstimateEditor
      projectId={id}
      jobNumber={job?.job_number ?? null}
      chats={chats ?? []}
      estimate={est}
      clientShow={showErr ? null : clientShow(showRow?.client_show)}
      docPrice={docPriceRow}
      groups={(groups ?? []) as EstGroup[]}
      items={(items ?? []) as EstItem[]}
      steps={(steps ?? []) as EstStep[]}
      catalog={{ groups: catGroups ?? [], items: catItems ?? [] }}
      types={types ?? []}
      units={units ?? []}
      measures={measures.list.map(({ m, sheet }) => ({ id: m.id, name: m.name, kind: m.kind, sheet: (sheet as { name?: string } | undefined)?.name ?? "", value: measurementValue(m, sheet) }))}
    />
  );
}
