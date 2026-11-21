import { notFound } from "next/navigation";
import type { EstGroup, EstItem, EstStep } from "@/lib/estimates";
import { measurementValue } from "@/lib/takeoff";
import { createClient } from "@/lib/supabase/server";
import { jobMeasures } from "../load";
import EstimateEditor from "./EstimateEditor";

export default async function EstimatePage({ params }: { params: Promise<{ id: string; eid: string }> }) {
  const { id, eid } = await params;
  const supabase = await createClient();
  const [{ data: est }, { data: groups }, { data: items }, { data: steps }, { data: job }, { data: catGroups }, { data: catItems }, { data: types }, { data: units }, measures] = await Promise.all([
    supabase.from("estimates").select("id, seq, kind, name, status, intro, terms, issued_on, signed_at, signed_by_name").eq("id", eid).eq("project_id", id).maybeSingle(),
    supabase.from("estimate_groups").select("id, name, description, client_view, display_qty, display_unit, position").eq("estimate_id", eid).order("position"),
    supabase.from("estimate_items").select("id, group_id, catalog_item_id, name, description, cost_type_id, unit_id, quantity, unit_cost, unit_price, measurement_id, qty_factor, waste_pct, position").eq("estimate_id", eid).order("position"),
    supabase.from("estimate_payment_steps").select("id, name, percent, position").eq("estimate_id", eid).order("position"),
    supabase.from("projects").select("job_number").eq("id", id).maybeSingle(),
    supabase.from("cost_groups").select("id, name, parent_id, description").eq("archived", false).order("position"),
    supabase.from("cost_items").select("id, cost_group_id, name, description, cost_type_id, unit_id, quantity, unit_cost, unit_price").eq("archived", false).order("position"),
    supabase.from("cost_types").select("id, name").order("position"),
    supabase.from("units").select("id, name, abbr").order("id"),
    jobMeasures(supabase, id),
  ]);
  if (!est) notFound();
  return (
    <EstimateEditor
      projectId={id}
      jobNumber={job?.job_number ?? null}
      estimate={est}
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
