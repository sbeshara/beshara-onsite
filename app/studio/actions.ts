"use server";

import { revalidatePath } from "next/cache";
import { getMe } from "@/lib/auth";
import type { ReportLine } from "@/lib/report-pdf";
import { listOpenJobs } from "@/lib/jobtread";
import { generateAll, nextReportFriday, postReport, reportWeek, shortDate, type ReportPhoto, type WeeklyReport } from "@/lib/reports";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { isAdminRole, isTeamRole } from "@/lib/types";

export type Result = { ok?: string; error?: string };
type Edits = {
  completed: ReportLine[];
  looking_ahead: ReportLine[];
  layout: WeeklyReport["layout"];
  skip_completed: boolean;
  photos: ReportPhoto[];
  pm_notes: string;
};

const clean = (lines: ReportLine[]) =>
  lines
    .map((l) => ({ trade: l.trade.trim(), text: l.text.trim() }))
    .filter((l) => l.trade || l.text);

async function requireAdmin() {
  const me = await getMe();
  if (!isAdminRole(me.role)) throw new Error("Only an Admin or the Principal Contractor can do that.");
  return me;
}

// PMs, Admins and the Principal Contractor can review, edit and approve the
// reports for the jobs they're on. Row-level security decides which those are.
async function requireReviewer(reportId: string) {
  const me = await getMe();
  if (!isTeamRole(me.role)) throw new Error("Beshara Reports is for the Beshara team.");
  const supabase = await createClient();
  const { data } = await supabase.from("weekly_reports").select("id, project_id, status").eq("id", reportId).maybeSingle();
  if (!data) throw new Error("You don't have access to this report.");
  return { me, report: data };
}

async function requireProject(projectId: string) {
  const me = await getMe();
  if (!isTeamRole(me.role)) throw new Error("Beshara Reports is for the Beshara team.");
  const { data } = await (await createClient()).from("projects").select("id").eq("id", projectId).maybeSingle();
  if (!data) throw new Error("You don't have access to this project.");
  return me;
}

// Saves edits. Called as people type, so it doesn't refresh the page.
export async function saveReport(id: string, edits: Edits): Promise<Result> {
  const me = await getMe();
  if (!isTeamRole(me.role)) return { error: "Beshara Reports is for the Beshara team." };
  const supabase = await createClient();
  const { error, count } = await supabase
    .from("weekly_reports")
    .update(
      {
        completed: clean(edits.completed),
        looking_ahead: clean(edits.looking_ahead),
        layout: edits.layout === "combined" ? "combined" : "standard",
        skip_completed: !!edits.skip_completed,
        photos: edits.photos,
        pm_notes: edits.pm_notes,
        updated_at: new Date().toISOString(),
        updated_by: me.id,
      },
      { count: "exact" },
    )
    .eq("id", id);
  if (error || !count) return { error: "Couldn't save. The report may have been approved or skipped already." };
  return { ok: "Saved." };
}

export async function approveReport(id: string, edits: Edits): Promise<Result> {
  try {
    const { me } = await requireReviewer(id);
    const saved = await saveReport(id, edits);
    if (saved.error) return saved;
    const admin = createAdminClient();
    const { data: report } = await admin.from("weekly_reports").select("*").eq("id", id).single();
    if (!report || report.status !== "draft") return { error: "This report isn't a draft anymore." };
    if (!(report.looking_ahead as ReportLine[]).length) return { error: "Add Looking Ahead first (next week's work from the Friday, Saturday or Sunday log)." };
    if (!(report.completed as ReportLine[]).length && !report.skip_completed) return { error: "Add at least one Completed item, or turn on \"Leave out the Completed page\"." };
    await admin
      .from("weekly_reports")
      .update({ status: "approved", approved_by: me.id, approved_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("status", "draft");
  } catch (e) {
    return { error: (e as Error).message };
  }
  revalidatePath("/", "layout");
  return { ok: "Approved. It's in Ready to Send; nothing goes to the client until it's sent." };
}

// Back from Ready to Send to draft, so it can be edited again.
export async function reopenReport(id: string): Promise<Result> {
  try {
    await requireReviewer(id);
    const { data } = await createAdminClient()
      .from("weekly_reports")
      .update({ status: "draft", approved_by: null, approved_at: null, updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("status", "approved")
      .select("id");
    if (!data?.length) return { error: "This report was already sent, so it can't be reopened." };
  } catch (e) {
    return { error: (e as Error).message };
  }
  revalidatePath("/", "layout");
  return { ok: "Reopened. Edit it, then approve it again." };
}

// The Principal Contractor or an Admin sends approved reports to clients.
export async function sendReports(ids: string[]): Promise<Result> {
  let sent = 0;
  const problems: string[] = [];
  try {
    const me = await requireAdmin();
    const admin = createAdminClient();
    const { data: reports } = await admin.from("weekly_reports").select("*, projects(name)").in("id", ids).eq("status", "approved");
    for (const r of (reports ?? []) as (WeeklyReport & { projects: { name: string } | null })[]) {
      try {
        await postReport(admin, r, me.id);
        sent++;
      } catch (e) {
        problems.push(`${r.projects?.name ?? "A report"}: ${(e as Error).message}`);
      }
    }
  } catch (e) {
    return { error: (e as Error).message };
  }
  revalidatePath("/", "layout");
  if (problems.length) return { error: `Sent ${sent}. Couldn't send ${problems.join("; ")}` };
  if (!sent) return { error: "Those reports were already sent or reopened." };
  return { ok: `Sent ${sent} report${sent === 1 ? "" : "s"} to ${sent === 1 ? "the client" : "clients"}.` };
}

export async function setReportStatus(id: string, status: "skipped" | "draft"): Promise<Result> {
  try {
    await requireReviewer(id);
    const admin = createAdminClient();
    const { data: report } = await admin.from("weekly_reports").select("status").eq("id", id).single();
    if (report?.status === "sent") return { error: "This report was already sent." };
    if (report?.status === "approved") return { error: "Reopen this report before changing it." };
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
    if (opts.projectId) await requireProject(opts.projectId);
    else await requireAdmin();
    // Reports are only drafted Friday through Monday, for that week.
    const week = reportWeek();
    if (!week) return { error: `Progress reports open Friday ${shortDate(nextReportFriday())} at 3 PM.` };
    if (opts.weekStart && opts.weekStart !== week) return { error: "That week is closed. Only this week's reports can be drafted." };
    const results = await generateAll(createAdminClient(), week, { force: opts.force, projectId: opts.projectId });
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
    await requireAdmin();
    const { error } = await createAdminClient().from("projects").update({ jobtread_job_id: jobId, jobtread_label: label }).eq("id", projectId);
    if (error) return { error: error.code === "23505" ? "That JobTread job is already linked to another project." : "Couldn't save the link." };
  } catch (e) {
    return { error: (e as Error).message };
  }
  revalidatePath("/studio", "layout");
  return { ok: jobId ? "Linked." : "Unlinked." };
}

// Creates an OnSite project (with its starter chats) for each chosen
// JobTread job, already linked so progress reports draft from its logs.
export async function importJobs(jobIds: string[]): Promise<Result> {
  try {
    const me = await requireAdmin();
    const admin = createAdminClient();
    const { data: linked } = await admin.from("projects").select("jobtread_job_id").not("jobtread_job_id", "is", null);
    const taken = new Set((linked ?? []).map((p) => p.jobtread_job_id));
    const jobs = (await listOpenJobs()).filter((j) => jobIds.includes(j.id) && !taken.has(j.id));
    if (!jobs.length) return { error: "Those jobs are already in OnSite." };
    const { error } = await admin.from("projects").insert(
      jobs.map((j) => ({
        name: (j.client ?? `Job ${j.number}`).slice(0, 120),
        town: j.town ?? "",
        phase: 2, // Construction
        created_by: me.id,
        jobtread_job_id: j.id,
        jobtread_label: j.label,
      })),
    );
    if (error) return { error: `Couldn't create the projects: ${error.message}` };
    revalidatePath("/", "layout");
    return { ok: `Added ${jobs.length} project${jobs.length === 1 ? "" : "s"} to OnSite. Invite each client from the project's Team & Clients page.` };
  } catch (e) {
    return { error: (e as Error).message };
  }
}
