import { getAccess } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import type { Markup } from "@/lib/plan-shapes";
import type { Measurement } from "@/lib/takeoff";
import PlansWorkspace, { type PlanFile, type Sheet } from "./PlansWorkspace";

export const metadata = { title: "Plans & Takeoff · Beshara OnSite" };

export default async function PlansPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { me } = await getAccess();
  const supabase = await createClient();
  const [{ data: files }, { data: sheets }, { data: measures }, { data: markups }, { data: chats }, { data: items }, { data: job }] = await Promise.all([
    supabase.from("plan_files").select("id, name, storage_path, page_count").eq("project_id", id).order("created_at"),
    supabase.from("plan_sheets").select("id, plan_file_id, page_number, name, width_pt, height_pt, scale_in_per_ft, points_per_foot, position").eq("project_id", id).order("position").order("page_number"),
    supabase.from("takeoff_measurements").select("id, sheet_id, name, kind, color, points, hidden").eq("project_id", id).order("created_at"),
    supabase.from("plan_markups").select("id, sheet_id, kind, color, data").eq("project_id", id).order("created_at"),
    supabase.from("chats").select("id, name").eq("project_id", id).eq("is_internal", false).order("position"),
    supabase.from("estimate_items").select("name, measurement_id, estimates!inner(project_id, seq, kind)").eq("estimates.project_id", id).not("measurement_id", "is", null),
    supabase.from("projects").select("job_number, name").eq("id", id).maybeSingle(),
  ]);
  const paths = (files ?? []).map((f) => f.storage_path);
  const { data: signed } = paths.length ? await supabase.storage.from("plans").createSignedUrls(paths, 60 * 60 * 6) : { data: [] };
  const url = Object.fromEntries((signed ?? []).map((s) => [s.path, s.signedUrl]));
  const feeds: Record<string, string[]> = {};
  for (const it of (items ?? []) as unknown as { name: string; measurement_id: string; estimates: { seq: number; kind: string } }[]) {
    (feeds[it.measurement_id] ??= []).push(`${it.name} (${it.estimates.kind} ${job?.job_number ? `${job.job_number}-` : "#"}${it.estimates.seq})`);
  }
  return (
    <PlansWorkspace
      projectId={id}
      meId={me.id}
      jobLabel={[job?.job_number, job?.name].filter(Boolean).join(" ")}
      files={((files ?? []) as Omit<PlanFile, "url">[]).map((f) => ({ ...f, url: url[f.storage_path] ?? "" }))}
      sheets={(sheets ?? []) as Sheet[]}
      measurements={(measures ?? []) as Measurement[]}
      markups={(markups ?? []) as Markup[]}
      chats={chats ?? []}
      feeds={feeds}
    />
  );
}
