import { BUDGET_ITEM_FIELDS, type BudgetGroup, type BudgetItem, type DocRef } from "@/lib/budget";
import { measurementValue } from "@/lib/takeoff";
import { createClient } from "@/lib/supabase/server";
import { jobMeasures } from "../estimates/load";
import BudgetEditor from "./BudgetEditor";

export const metadata = { title: "Budget · Beshara OnSite" };

export default async function BudgetPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const [{ data: job }, { data: groups, error }, { data: items }, { data: links }, { data: catGroups }, { data: catItems }, { data: types }, { data: units }, measures] = await Promise.all([
    supabase.from("projects").select("job_number").eq("id", id).maybeSingle(),
    supabase.from("budget_groups").select("id, name, description, position").eq("project_id", id).order("position"),
    supabase.from("budget_items").select(BUDGET_ITEM_FIELDS).eq("project_id", id).order("position"),
    supabase.from("estimate_items").select("budget_item_id, estimates!inner(id, seq, kind, name, status, project_id)").eq("estimates.project_id", id).not("budget_item_id", "is", null),
    supabase.from("cost_groups").select("id, name, parent_id, description").eq("archived", false).order("position"),
    supabase.from("cost_items").select("id, cost_group_id, name, description, cost_type_id, unit_id, quantity, unit_cost, unit_price").eq("archived", false).order("position"),
    supabase.from("cost_types").select("id, name").order("position"),
    supabase.from("units").select("id, name, abbr").order("id"),
    jobMeasures(supabase, id),
  ]);
  if (error) {
    return <div className="page"><p className="err">The budget needs the latest database update. Run the newest SQL file, then reload.</p></div>;
  }
  const { count: docCount } = await supabase.from("estimates").select("id", { count: "exact", head: true }).eq("project_id", id).neq("status", "denied");
  // Which documents each budget line is on.
  const on: Record<string, DocRef[]> = {};
  for (const l of (links ?? []) as unknown as { budget_item_id: string; estimates: { id: string; seq: number; kind: string; name: string; status: string } }[]) {
    const e = l.estimates;
    (on[l.budget_item_id] ??= []).some((d) => d.estimate_id === e.id) || on[l.budget_item_id].push({ estimate_id: e.id, seq: e.seq, kind: e.kind, name: e.name, status: e.status });
  }
  const all = catGroups ?? [];
  const templates = all.filter((g) => all.some((c) => c.parent_id === g.id)).map((g) => ({ id: g.id, name: g.name }));
  return (
    <BudgetEditor
      projectId={id}
      jobNumber={job?.job_number ?? null}
      groups={(groups ?? []) as BudgetGroup[]}
      items={(items ?? []) as BudgetItem[]}
      on={on}
      unlinkedDocs={(docCount ?? 0) > 0}
      templates={templates}
      catalog={{ groups: catGroups ?? [], items: catItems ?? [] }}
      types={types ?? []}
      units={units ?? []}
      measures={measures.list.map(({ m, sheet }) => ({ id: m.id, name: m.name, kind: m.kind, sheet: (sheet as { name?: string } | undefined)?.name ?? "", value: measurementValue(m, sheet) }))}
    />
  );
}
