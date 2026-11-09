import "server-only";
import { constructionCheck } from "./construction";
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
  status: "draft" | "approved" | "sent" | "skipped" | "no_logs"; // approved = ready to send
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
  sent_at: string | null;
  sent_by: string | null;
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
export function lastFullWeek(now = clock()) {
  return addDays(mondayOf(nj(now).date), -7);
}

// "Now" for the report schedule. REPORTS_NOW pins it for testing only.
export const clock = () => (process.env.REPORTS_NOW ? new Date(process.env.REPORTS_NOW) : new Date());

// Progress reports are open from Friday at 10 AM until Monday at noon, for
// everyone (PMs, Admins and the Principal Contractor). They're drafted Friday
// from 10 AM from whatever daily logs are in, and untouched drafts are
// redrafted as Friday's logs come in.
// Returns the Monday of the week being reported, or null while closed.
export const OPENS = "Friday at 10 AM";
export const OPEN_HOUR = 10; // Friday: open, and drafting starts
export const CLOSE_HOUR = 12; // Monday
export function reportWeek(now = clock(), _opts: { admin?: boolean } = {}) {
  const t = nj(now);
  const monday = mondayOf(t.date);
  if ((t.weekday === "Fri" && t.hour >= OPEN_HOUR) || t.weekday === "Sat" || t.weekday === "Sun") return monday;
  if (t.weekday === "Mon" && t.hour < CLOSE_HOUR) return addDays(monday, -7);
  return null;
}
// The Friday the next reports open (for "opens Friday 10/31" messages).
export const nextReportFriday = (now = clock()) => {
  const t = nj(now);
  const friday = addDays(mondayOf(t.date), 4);
  return t.weekday === "Sat" || t.weekday === "Sun" ? addDays(friday, 7) : friday;
};

// The scheduler calls hourly while reports are open (Friday 10 AM to Monday
// noon). Every run drafts any job not drafted yet and redrafts drafts nobody
// has edited whenever that week's daily logs (Monday through Sunday) have
// changed, so a Saturday or Sunday log is pulled in on its own. Saturday at
// 8 AM it also emails PMs whose report is still missing Looking Ahead.
export function scheduleSlot(now = clock()) {
  if (!reportWeek(now)) return null;
  const t = nj(now);
  return t.weekday === "Sat" && t.hour === 8 ? ("saturday" as const) : ("refresh" as const);
}

export const shortDate = (iso: string) => {
  const [y, m, d] = iso.split("-");
  return `${Number(m)}/${Number(d)}/${y.slice(2)}`;
};
export const weekLabel = (weekStart: string) => `${shortDate(weekStart)} - ${shortDate(addDays(weekStart, 6))}`;
// Looking Ahead comes from the Friday, Saturday or Sunday log.
export const lookAheadDates = (weekStart: string) => [4, 5, 6].map((n) => addDays(weekStart, n));

// ---- Drafting ----------------------------------------------------------------

type SourceLog = { date: string; notes: string };
// Whether the daily logs are the same ones a draft was made from.
const logKey = (logs: SourceLog[]) => JSON.stringify(logs.map((l) => [l.date, (l.notes ?? "").trim()]).sort());
const sameLogs = (now: SourceLog[], before: SourceLog[] | null) => !!before && logKey(now) === logKey(before);

type ProjectForReport = { id: string; name: string; town: string; jobtread_job_id: string | null };

export type GenerateOpts = {
  force?: boolean; // redraft an existing draft (the Redraft button)
  waitForFriday?: boolean; // skip jobs with no Friday daily log yet
  refreshUntouched?: boolean; // redraft drafts nobody has edited whenever the week's daily logs have changed
  notify?: boolean; // email the PMs when Looking Ahead is missing
};

export async function generateReport(admin: Admin, project: ProjectForReport, weekStart: string, opts: GenerateOpts = {}) {
  if (!project.jobtread_job_id) return { project: project.name, result: "not linked" };
  const { data: existing } = await admin
    .from("weekly_reports")
    .select("id, status, updated_by, looking_ahead, source_logs")
    .eq("project_id", project.id)
    .eq("week_start", weekStart)
    .maybeSingle();
  // Nobody has edited it (a draft, or a "no logs yet" placeholder), so it can be redrafted.
  const untouched = !!existing && ["draft", "no_logs"].includes(existing.status) && !existing.updated_by;
  const stale = untouched && !(existing!.looking_ahead as unknown[]).length;
  if (existing && ["approved", "sent"].includes(existing.status)) return { project: project.name, result: "exists" };
  if (existing && !opts.force && !(opts.refreshUntouched && untouched)) return { project: project.name, result: "exists" };

  const base = { project_id: project.id, week_start: weekStart, generated_at: new Date().toISOString(), updated_at: new Date().toISOString() };
  try {
    const logs = await dailyLogs(project.jobtread_job_id, weekStart, addDays(weekStart, 6));
    // An untouched draft is only redrafted when the week's logs have changed
    // since it was drafted (a new or edited log). Otherwise it stays, and on
    // Saturday 8 AM the PMs are asked for Looking Ahead if it's still missing.
    if (existing && !opts.force && sameLogs(logs, existing.source_logs as SourceLog[] | null)) {
      const hadLog = logs.some((l) => lookAheadDates(weekStart).includes(l.date));
      if (opts.notify && stale) await askPmsForLookingAhead(admin, project, weekStart, existing.id, hadLog);
      return { project: project.name, result: stale && !hadLog ? "waiting for Friday log" : "up to date" };
    }
    if (opts.waitForFriday && !logs.some((l) => l.date === addDays(weekStart, 4))) return { project: project.name, result: "waiting for Friday log" };
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
    if (opts.notify && !draft.looking_ahead.length && saved) await askPmsForLookingAhead(admin, project, weekStart, saved.id, logs.some((l) => lookAheadDates(weekStart).includes(l.date)));
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

// Drafts every job in construction (or the one project asked for), reading
// daily logs from its construction job in JobTread.
export async function generateAll(admin: Admin, weekStart: string, opts: GenerateOpts & { projectId?: string } = {}) {
  let q = admin.from("projects").select("id, name, town, phase, jobtread_job_id").not("jobtread_job_id", "is", null);
  if (opts.projectId) q = q.eq("id", opts.projectId);
  const { data } = await q;
  const projects = (data ?? []) as (ProjectForReport & { phase: number })[];
  const check = await constructionCheck(projects);
  const results = [];
  for (const p of projects) {
    if (!opts.projectId && check.ok && !check.inConstruction(p)) {
      results.push({ project: p.name, result: "not in construction" });
      continue;
    }
    const job = check.jobsFor(p)[0] ?? p.jobtread_job_id;
    results.push(await generateReport(admin, { ...p, jobtread_job_id: job }, weekStart, opts));
  }
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
export async function postReport(admin: Admin, report: WeeklyReport, senderId: string) {
  if (report.status !== "approved") throw new Error(report.status === "sent" ? "This report was already sent." : "Approve this report before sending it.");
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
    .insert({ chat_id: chat.id, author_id: senderId, body: reportCaption(report), posted_as: "company" })
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
    uploaded_by: senderId,
  });
  const { error: markErr } = await admin
    .from("weekly_reports")
    .update({ status: "sent", sent_by: senderId, sent_at: new Date().toISOString(), message_id: msg.id, updated_at: new Date().toISOString() })
    .eq("id", report.id);
  if (markErr) throw new Error(`The PDF was posted, but the report couldn't be marked as sent: ${markErr.message}`);
  return msg.id as string;
}

// Approved reports waiting to be sent, oldest week first (only the projects
// the signed-in person can see, since this uses their client).
// `only` limits it to these projects (e.g. when viewing as a PM).
export async function readyToSend(supabase: Pick<Admin, "from">, only?: string[] | null) {
  let q = supabase
    .from("weekly_reports")
    .select("id, week_start, approved_at, approved_by, projects(name), approver:profiles!weekly_reports_approved_by_fkey(full_name)")
    .eq("status", "approved");
  if (only) q = q.in("project_id", only);
  const { data } = await q.order("week_start").order("approved_at");
  type Row = { id: string; week_start: string; approved_at: string; projects: { name: string } | null; approver: { full_name: string } | null };
  return ((data ?? []) as unknown as Row[]).map((r) => ({
    id: r.id,
    project: r.projects?.name ?? "Project",
    weekStart: r.week_start,
    weekLabel: shortDate(r.week_start),
    approvedBy: r.approver?.full_name ?? "",
    approvedAt: r.approved_at,
  }));
}
