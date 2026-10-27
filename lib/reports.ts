import "server-only";
import { FILES_BUCKET } from "./constants";
import { storagePath, TZ } from "./format";
import { dailyLogs, fileUrls, scheduleBetween } from "./jobtread";
import { buildReportPdf, type ReportLine } from "./report-pdf";
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

// ---- Drafting ----------------------------------------------------------------

type ProjectForReport = { id: string; name: string; town: string; jobtread_job_id: string | null };

export async function generateReport(admin: Admin, project: ProjectForReport, weekStart: string, opts: { force?: boolean } = {}) {
  if (!project.jobtread_job_id) return { project: project.name, result: "not linked" };
  const { data: existing } = await admin.from("weekly_reports").select("id, status").eq("project_id", project.id).eq("week_start", weekStart).maybeSingle();
  if (existing && (!opts.force || existing.status === "approved")) return { project: project.name, result: "exists" };

  const weekEnd = addDays(weekStart, 6);
  const nextMonday = addDays(weekStart, 7);
  const base = { project_id: project.id, week_start: weekStart, generated_at: new Date().toISOString(), updated_at: new Date().toISOString() };
  try {
    const logs = await dailyLogs(project.jobtread_job_id, weekStart, weekEnd);
    const source = logs.map((l) => ({ date: l.date, author: l.author, notes: l.notes, trades: l.trades }));
    if (!logs.length || logs.every((l) => !l.notes.trim())) {
      await admin.from("weekly_reports").upsert({ ...base, status: "no_logs", completed: [], looking_ahead: [], photos: [], source_logs: source, error: null }, { onConflict: "project_id,week_start" });
      return { project: project.name, result: "no logs" };
    }
    const schedule = await scheduleBetween(project.jobtread_job_id, nextMonday, addDays(nextMonday, 13)).catch(() => []);
    const draft = await draftReport({ project: project.name, weekOf: weekLabel(weekStart), logs, schedule });
    // Suggest up to four photos: the first from each day, then fill in.
    const all = logs.flatMap((l) => l.photos.map((p) => ({ ...p, log_date: l.date })));
    const firsts = new Set(logs.map((l) => l.photos[0]?.id).filter(Boolean).slice(0, 4));
    for (const p of all) if (firsts.size < 4) firsts.add(p.id);
    const photos: ReportPhoto[] = all.map((p) => ({ id: p.id, name: p.name, log_date: p.log_date, selected: firsts.has(p.id) }));
    await admin.from("weekly_reports").upsert(
      { ...base, status: "draft", completed: draft.completed, looking_ahead: draft.looking_ahead, photos, source_logs: source, error: null, approved_at: null, approved_by: null },
      { onConflict: "project_id,week_start" },
    );
    return { project: project.name, result: "drafted" };
  } catch (e) {
    const message = (e as Error).message.slice(0, 500);
    await admin.from("weekly_reports").upsert({ ...base, status: "draft", error: message }, { onConflict: "project_id,week_start", ignoreDuplicates: !!existing });
    return { project: project.name, result: `error: ${message}` };
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

export function reportText(r: Pick<WeeklyReport, "week_start" | "completed" | "looking_ahead">) {
  const line = (l: ReportLine) => `• ${l.trade}: ${l.text}${l.date ? ` (${l.date})` : ""}`;
  return [
    `Weekly Progress Report · Week of ${weekLabel(r.week_start)}`,
    "",
    "COMPLETED",
    ...(r.completed.length ? r.completed.map(line) : ["No work to report this week."]),
    "",
    `LOOKING AHEAD · Week of ${shortDate(addDays(r.week_start, 7))}`,
    ...(r.looking_ahead.length ? r.looking_ahead.map(line) : ["Upcoming work will be shared in next week's report."]),
  ].join("\n");
}

async function download(url: string) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Couldn't download a photo (${res.status})`);
  return { bytes: new Uint8Array(await res.arrayBuffer()), type: res.headers.get("content-type") ?? "image/jpeg" };
}

export async function reportPdf(admin: Admin, report: WeeklyReport) {
  const { data: project } = await admin.from("projects").select("name, town, jobtread_label").eq("id", report.project_id).single();
  const chosen = report.photos.filter((p) => p.selected);
  const urls = await fileUrls(chosen.map((p) => p.id), 1600).catch(() => ({}) as Record<string, string>);
  const photos = [];
  for (const p of chosen) if (urls[p.id]) photos.push({ ...(await download(urls[p.id])), caption: shortDate(p.log_date) });
  const pdf = await buildReportPdf({
    practice: project?.name ?? "Project",
    address: project?.town ? `${project.town}, NJ` : null,
    weekLabel: weekLabel(report.week_start),
    nextWeekLabel: shortDate(addDays(report.week_start, 7)),
    completed: report.completed,
    lookingAhead: report.looking_ahead,
    photos,
  });
  return { pdf, photos, chosen, projectName: project?.name ?? "Project" };
}

// Posts an approved report to the project's Weekly Progress Report chat as Beshara Builders.
export async function postReport(admin: Admin, report: WeeklyReport, approverId: string) {
  const { data: chats } = await admin.from("chats").select("id, name, is_internal").eq("project_id", report.project_id).order("position");
  const chat =
    chats?.find((c) => !c.is_internal && /weekly (progress|update)/i.test(c.name)) ?? chats?.find((c) => !c.is_internal);
  if (!chat) throw new Error("This project has no client chat to post in.");

  const { pdf, photos, chosen, projectName } = await reportPdf(admin, report);
  const { data: msg, error } = await admin
    .from("messages")
    .insert({ chat_id: chat.id, author_id: approverId, body: reportText(report), posted_as: "company" })
    .select("id")
    .single();
  if (error || !msg) throw new Error(`Couldn't post the report: ${error?.message}`);

  const [y, m, d] = report.week_start.split("-");
  const uploads: { name: string; bytes: Uint8Array; type: string; folder: string }[] = [
    { name: `${projectName} ${m}${d}${y.slice(2)} Beshara Builders Progress Report.pdf`, bytes: pdf, type: "application/pdf", folder: "Submittals" },
    ...photos.map((p, i) => ({ name: chosen[i]?.name ?? `Photo ${i + 1}.jpg`, bytes: p.bytes, type: p.type, folder: "Photos" })),
  ];
  for (const u of uploads) {
    const path = storagePath(report.project_id, u.name);
    const up = await admin.storage.from(FILES_BUCKET).upload(path, u.bytes, { contentType: u.type });
    if (up.error) continue;
    await admin.from("files").insert({
      project_id: report.project_id,
      message_id: msg.id,
      name: u.name,
      storage_path: path,
      size_bytes: u.bytes.length,
      mime_type: u.type,
      folder: u.folder,
      is_internal: false,
      uploaded_by: approverId,
    });
  }
  await admin
    .from("weekly_reports")
    .update({ status: "approved", approved_by: approverId, approved_at: new Date().toISOString(), message_id: msg.id, updated_at: new Date().toISOString() })
    .eq("id", report.id);
  return msg.id as string;
}
