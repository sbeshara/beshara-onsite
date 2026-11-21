import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Measurement, SheetScale } from "@/lib/takeoff";

// A job's takeoff measurements with their sheets' scales, for linked quantities.
export async function jobMeasures(supabase: SupabaseClient, projectId: string) {
  const [{ data: ms }, { data: sheets }] = await Promise.all([
    supabase.from("takeoff_measurements").select("id, sheet_id, name, kind, color, points, hidden").eq("project_id", projectId).order("created_at"),
    supabase.from("plan_sheets").select("id, name, scale_in_per_ft, points_per_foot").eq("project_id", projectId),
  ]);
  const bySheet = new Map((sheets ?? []).map((s) => [s.id as string, s as SheetScale & { id: string; name: string }]));
  const list = ((ms ?? []) as Measurement[]).map((m) => ({ m, sheet: bySheet.get(m.sheet_id) }));
  return { list, map: new Map(list.map((x) => [x.m.id, x])) };
}
