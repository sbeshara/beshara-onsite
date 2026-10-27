"use server";

import { revalidatePath } from "next/cache";
import { getMe } from "@/lib/auth";
import type { ReportLine } from "@/lib/report-pdf";
import { generateAll, lastFullWeek, postReport, type ReportPhoto, type WeeklyReport } from "@/lib/reports";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { isAdminRole, isTeamRole } from "@/lib/types";

export type Result = { ok?: string; error?: string };
type Edits = { completed: ReportLine[]; looking_ahead: ReportLine[]; photos: ReportPhoto[]; pm_notes: string };

const clean = (lines: ReportLine[]) =>
  lines
    .map((l) => ({ trade: l.trade.trim(), text: l.text.trim(), ...(l.date !== undefined ? { date: l.date.trim() } : {}) }))
    .filter((l) => l.trade || l.text);

async function requireApprover() {
  const me = await getMe();
  if (!isAdminRole(me.role)) throw new Error("Only an Admin or the Principal Contractor can approve reports.");
  return me;
}

// Anyone on the team with access to the project can edit a draft.
export async function saveReport(id: string, edits: Edits): Promise<Result> {
  const me = await getMe();
  if (!isTeamRole(me.role)) return { error: "Beshara Reports is for the Beshara team." };
  const supabase = await createClient();
  const { error, count } = await supabase
    .from("weekly_reports")
    .update(
      { completed: clean(edits.completed), looking_ahead: clean(edits.looking_ahead), photos: edits.photos, pm_notes: edits.pm_notes, updated_at: new Date().toISOString(), updated_by: me.id },
      { count: "exact" },
    )
    .eq("id", id);
  if (error || !count) return { error: "Couldn't save. The report may have been approved or skipped already." };
  revalidatePath("/studio", "layout");
  return { ok: "Saved." };
}

export async function approveReport(id: string, edits: Edits): Promise<Result> {
  try {
    const me = await requireApprover();
    const saved = await saveReport(id, edits);
    if (saved.error) return saved;
    const admin = createAdminClient();
    const { data: report } = await admin.from("weekly_reports").select("*").eq("id", id).single();
    if (!report || report.status !== "draft") return { error: "This report isn't a draft anymore." };
    if (!(report.completed as ReportLine[]).length) return { error: "Add at least one Completed item before approving." };
    await postReport(admin, report as WeeklyReport, me.id);
  } catch (e) {
    return { error: (e as Error).message };
  }
  revalidatePath("/studio", "layout");
  return { ok: "Approved and posted to the client's Weekly Progress Report chat." };
}

export async function setReportStatus(id: string, status: "skipped" | "draft"): Promise<Result> {
  try {
    await requireApprover();
    const admin = createAdminClient();
    const { data: report } = await admin.from("weekly_reports").select("status").eq("id", id).single();
    if (report?.status === "approved") return { error: "This report was already posted." };
    await admin.from("weekly_reports").update({ status, updated_at: new Date().toISOString() }).eq("id", id);
  } catch (e) {
    return { error: (e as Error).message };
  }
  revalidatePath("/studio", "layout");
  return { ok: status === "skipped" ? "Skipped for this week." : "Back to draft." };
}

// Drafts now instead of waiting for Monday. force=true rewrites an existing draft.
export async function generateNow(opts: { projectId?: string; force?: boolean; weekStart?: string } = {}): Promise<Result> {
  try {
    await requireApprover();
    const results = await generateAll(createAdminClient(), opts.weekStart ?? lastFullWeek(), opts);
    revalidatePath("/studio", "layout");
    const drafted = results.filter((r) => r.result === "drafted").length;
    const failed = results.filter((r) => r.result.startsWith("error"));
    if (failed.length) return { error: `Drafted ${drafted}. Problems: ${failed.map((f) => `${f.project} (${f.result.slice(7)})`).join("; ")}` };
    if (!results.length) return { error: "No projects are linked to JobTread jobs yet. Link them on the Jobs page." };
    return { ok: drafted ? `Drafted ${drafted} report${drafted === 1 ? "" : "s"}.` : "Everything is already drafted for that week." };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function linkJob(projectId: string, jobId: string | null, label: string | null): Promise<Result> {
  try {
    await requireApprover();
    const { error } = await createAdminClient().from("projects").update({ jobtread_job_id: jobId, jobtread_label: label }).eq("id", projectId);
    if (error) return { error: error.code === "23505" ? "That JobTread job is already linked to another project." : "Couldn't save the link." };
  } catch (e) {
    return { error: (e as Error).message };
  }
  revalidatePath("/studio", "layout");
  return { ok: jobId ? "Linked." : "Unlinked." };
}
