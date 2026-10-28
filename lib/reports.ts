import "server-only";
import { FILES_BUCKET } from "./constants";
import { storagePath, TZ } from "./format";
import { dailyLogs, fileUrls } from "./jobtread";
import { sendEmail } from "./notify";
import { buildReportPdf, lineText, reportFileName, type ReportLine } from "./report-pdf";
import { draftReport } from "./report-ai";
import { createAdminClient } from "./supabase/admin";

type Admin = ReturnType<typeof createAdminClient>;

export type ReportPhoto = { id: string; name: string; log_date: string; selected: boolean };
export type WeeklyReport = {
  id: string;
  project_id: string;
  week_start: string;
  status: "draft" | "approved" | "skipped" | "no_logs";
  completed: ReportLine[];
  looking_ahead: ReportLine[];
  layout: "standard" | "combined";
  skip_completed: boolean;
  photos: ReportPhoto[];
  source_logs: { date: string; author: string; notes: string; trades: string[] }[];
  pm_notes: string;
  error: string | null;
  generated_at: string;
  updated_at: string;
  approved_at: string | null;
  approved_by: string | null;
  updated_by: string | null;
  message_id: string | null;
};

// ---- Dates (always New Jersey time) ----------------------------------------

function nj(now = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short", hour: "numeric", hourCycle: "h23" })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, weekday: parts.weekday as string, hour: Number(parts.hour) };
}

export function addDays(iso: string, n: number) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function mondayOf(iso: string) {
  const d = new Date(`${iso}T12:00:00Z`);
  return addDays(iso, -((d.getUTCDay() + 6) % 7));
}

// The week a report covers: the most recent full Monday-Sunday week.
export function lastFullWeek(now = new Date()) {
  return addDays(mondayOf(nj(now).date), -7);
}

export const isMondayMorning = (now = new Date()) => {
  const t = nj(now);
  return t.weekday === "Mon" && t.hour >= 8;
};

export const shortDate = (iso: string) => {
  const [y, m, d] = iso.split("-");
  return `${Number(m)}/${Number(d)}/${y.slice(2)}`;
};
export const weekLabel = (weekStart: string) => `${shortDate(weekStart)} - ${shortDate(addDays(weekStart, 6))}`;
// Looking Ahead comes from the Friday, Saturday or Sunday log.
export const lookAheadDates = (weekStart: string) => [4, 5, 6].map((n) => addDays(weekStart, n));

// ---- Drafting ----------------------------------------------------------------

type ProjectForReport = { id: string; name: string; town: string; jobtread_job_id: string | null };

export async function generateReport(admin: Admin, project: ProjectForReport, weekStart: string, opts: { force?: boolean } = {}) {
  if (!project.jobtread_job_id) return { project: project.name, result: "not linked" };
  const { data: existing } = await admin.from("weekly_reports").select("id, status").eq("project_id", project.id).eq("week_start", weekStart).maybeSingle();
  if (existing && (!opts.force || existing.status === "approved")) return { project: project.name, result: "exists" };

  const base = { project_id: project.id, week_start: weekStart, generated_at: new Date().toISOString(), updated_at: new Date().toISOString() };
  try {
    const logs = await dailyLogs(project.jobtread_job_id, weekStart, addDays(weekStart, 6));
    const source = logs.map((l) => ({ date: l.date, author: l.author, notes: l.notes, trades: l.trades }));
    if (!logs.length || logs.every((l) => !l.notes.trim())) {
      await admin.from("weekly_reports").upsert({ ...base, status: "no_logs", completed: [], looking_ahead: [], photos: [], source_logs: source, error: null }, { onConflict: "project_id,week_start" });
      return { project: project.name, result: "no logs" };
    }
    const draft = await draftReport({ project: project.name, weekOf: shortDate(weekStart), lookAheadDates: lookAheadDates(weekStart), logs });
    // The PDF has two photo spots; suggest the first photo from the latest days.
    const all = logs.flatMap((l) => l.photos.map((p) => ({ ...p, log_date: l.date })));
    const picks = new Set([...logs].reverse().map((l) => l.photos[0]?.id).filter(Boolean).slice(0, 2));
    for (const p of all) if (picks.size < 2) picks.add(p.id);
    const photos: ReportPhoto[] = all.map((p) => ({ id: p.id, name: p.name, log_date: p.log_date, selected: picks.has(p.id) }));
    const { data: saved } = await admin
      .from("weekly_reports")
      .upsert(
        { ...base, status: "draft", completed: draft.completed, looking_ahead: draft.looking_ahead, photos, source_logs: source, error: null, approved_at: null, approved_by: null },
        { onConflict: "project_id,week_start" },
      )
      .select("id")
      .single();
    if (!draft.looking_ahead.length && saved) await askPmsForLookingAhead(admin, project, weekStart, saved.id, logs.some((l) => lookAheadDates(weekStart).includes(l.date)));
    return { project: project.name, result: "drafted" };
  } catch (e) {
    const message = (e as Error).message.slice(0, 500);
    await admin.from("weekly_reports").upsert({ ...base, status: "draft", error: message }, { onConflict: "project_id,week_start", ignoreDuplicates: !!existing });
    return { project: project.name, result: `error: ${message}` };
  }
}

const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

// When Looking Ahead is missing, the PMs on the project (its Construction
// Management members in OnSite) are asked to add it. A project with no PM
// assigned goes to the Admins instead.
async function askPmsForLookingAhead(admin: Admin, project: ProjectForReport, weekStart: string, reportId: string, hadLog: boolean) {
  type Person = { email: string; full_name: string; role: string };
  const { data: members } = await admin.from("project_members").select("profiles(email, full_name, role)").eq("project_id", project.id);
  let to = (members ?? []).map((m) => m.profiles as unknown as Person | null).filter((p): p is Person => !!p && p.role === "construction");
  if (!to.length) {
    const { data: admins } = await admin.from("profiles").select("email, full_name, role").eq("role", "admin");
    to = (admins ?? []) as Person[];
  }
  const link = `${process.env.NEXT_PUBLIC_REPORTS_URL ?? "https://reports.besharabuilders.com"}/studio?week=${weekStart}&r=${reportId}`;
  const why = hadLog
    ? "none of the Friday, Saturday or Sunday daily logs has a work-to-be-conducted section"
    : "there's no Friday, Saturday or Sunday daily log";
  for (const p of to) {
    await sendEmail(
      p.email,
      `Looking Ahead needed: ${project.name}, week of ${shortDate(weekStart)}`,
      `<p>Hi ${esc(p.full_name.split(" ")[0] || "there")},</p>
<p>The progress report for <b>${esc(project.name)}</b> (week of ${shortDate(weekStart)}) is drafted, but ${why}, so Looking Ahead is empty.</p>
<p>Please add next week's work, then approve it: <a href="${link}">${link}</a></p>
<p>Beshara Reports</p>`,
    ).catch(() => null);
  }
}

export async function generateAll(admin: Admin, weekStart: string, opts: { force?: boolean; projectId?: string } = {}) {
  let q = admin.from("projects").select("id, name, town, jobtread_job_id").not("jobtread_job_id", "is", null);
  if (opts.projectId) q = q.eq("id", opts.projectId);
  const { data: projects } = await q;
  const results = [];
  for (const p of (projects ?? []) as ProjectForReport[]) results.push(await generateReport(admin, p, weekStart, opts));
  return results;
}

// ---- Posting ------------------------------------------------------------------

// The one line posted with the PDF in the client's Progress Reports chat.
export const reportCaption = (r: Pick<WeeklyReport, "week_start">) => `Progress Report · Week of ${shortDate(r.week_start)}`;

async function download(url: string) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Couldn't download a photo (${res.status})`);
  return { bytes: new Uint8Array(await res.arrayBuffer()), type: res.headers.get("content-type") ?? "image/jpeg" };
}

export async function reportPdf(admin: Admin, report: WeeklyReport) {
  const { data: project } = await admin.from("projects").select("name, town, jobtread_label").eq("id", report.project_id).single();
  const chosen = report.layout === "combined" || report.skip_completed ? [] : report.photos.filter((p) => p.selected).slice(0, 2);
  const urls = await fileUrls(chosen.map((p) => p.id), 1600).catch(() => ({}) as Record<string, string>);
  const photos = [];
  for (const p of chosen) if (urls[p.id]) photos.push(await download(urls[p.id]));
  const week = shortDate(report.week_start);
  const pdf = await buildReportPdf({
    name: project?.name ?? "Project",
    week,
    nextWeek: shortDate(addDays(report.week_start, 7)),
    completed: report.completed.map(lineText),
    ahead: report.looking_ahead.map(lineText),
    photos,
    combined: report.layout === "combined",
    skipCompleted: report.skip_completed,
  });
  const fileName = reportFileName(project?.name ?? "Project", week, !report.looking_ahead.length);
  return { pdf, photos, chosen, fileName };
}

// Posts an approved report to the project's Progress Reports chat as Beshara
// Builders: the PDF as an attachment, with a one-line caption.
export async function postReport(admin: Admin, report: WeeklyReport, approverId: string) {
  const { data: chats } = await admin.from("chats").select("id, name, is_internal").eq("project_id", report.project_id).order("position");
  const chat =
    chats?.find((c) => !c.is_internal && /progress report|weekly (progress|update)/i.test(c.name)) ?? chats?.find((c) => !c.is_internal);
  if (!chat) throw new Error("This project has no client chat to post in.");

  const { pdf, fileName } = await reportPdf(admin, report);
  const path = storagePath(report.project_id, fileName);
  const up = await admin.storage.from(FILES_BUCKET).upload(path, pdf, { contentType: "application/pdf" });
  if (up.error) throw new Error(`Couldn't upload the PDF: ${up.error.message}`);

  const { data: msg, error } = await admin
    .from("messages")
    .insert({ chat_id: chat.id, author_id: approverId, body: reportCaption(report), posted_as: "company" })
    .select("id")
    .single();
  if (error || !msg) {
    await admin.storage.from(FILES_BUCKET).remove([path]);
    throw new Error(`Couldn't post the report: ${error?.message}`);
  }
  await admin.from("files").insert({
    project_id: report.project_id,
    message_id: msg.id,
    name: fileName,
    storage_path: path,
    size_bytes: pdf.length,
    mime_type: "application/pdf",
    folder: "Submittals",
    is_internal: false,
    uploaded_by: approverId,
  });
  await admin
    .from("weekly_reports")
    .update({ status: "approved", approved_by: approverId, approved_at: new Date().toISOString(), message_id: msg.id, updated_at: new Date().toISOString() })
    .eq("id", report.id);
  return msg.id as string;
}
