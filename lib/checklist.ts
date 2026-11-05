import "server-only";
import { HQ_URL } from "./apps";
import { TZ } from "./format";
import { constructionCheck } from "./construction";
import { logAuthorsSince, logsOn } from "./jobtread";
import { brandEmail, escapeHtml as esc, sendEmail } from "./notify";
import { createAdminClient } from "./supabase/admin";

type Admin = ReturnType<typeof createAdminClient>;

// The daily job checklist for Construction Management. Only jobs in
// construction are on it: a job linked to JobTread while its Status there is
// Construction, an unlinked job while its OnSite phase is Construction. A job
// is done for the day only when JobTread has a daily log for it; there's no
// ticking it by hand.
//
// Some customers have more than one JobTread job (e.g. the build and a
// separate invoicing job). If a project is linked to one that isn't in
// construction, the same customer's job that is in construction stands in.


export type CheckItem = {
  projectId: string;
  name: string;
  town: string;
  phase: number;
  linked: boolean; // has a JobTread job, so daily logs can check it off
  done: null | { by: "log"; author: string; at: string };
};
export type PersonChecklist = { userId: string; name: string; email: string; items: CheckItem[] };

// REPORTS_NOW pins the clock for testing only (as for progress reports).
export function njNow(now = process.env.REPORTS_NOW ? new Date(process.env.REPORTS_NOW) : new Date()) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short", hour: "numeric", hourCycle: "h23" })
      .formatToParts(now)
      .map((x) => [x.type, x.value]),
  );
  return { day: `${p.year}-${p.month}-${p.day}`, weekday: p.weekday as string, hour: Number(p.hour) };
}
export const isWeekday = (weekday: string) => !["Sat", "Sun"].includes(weekday);

// Everyone's checklist for one day (or just one person's).
export async function loadChecklists(admin: Admin, day: string, onlyUser?: string): Promise<PersonChecklist[]> {
  return (await loadChecklistStatus(admin, day, onlyUser)).people;
}

// Who writes each job's daily log. A job can have several Construction
// Management people on it, but only one is responsible for its daily log, so
// it's on only their checklist. An admin can pick that person (Team & Access,
// By Job); otherwise it's whoever on the job has written the most of its
// JobTread daily logs in the last 30 days, or, with no history, the first of
// them alphabetically. A log written by anyone still checks the job off.
export type LogOwner = { userId: string; how: "chosen" | "only" | "logs" | "guess" };
export const LOG_OWNER_KEY = (projectId: string) => `dailylog:${projectId}`;

type Member = { id: string; full_name: string; email: string };
type ProjectRow = { id: string; name: string; town: string; phase: number; jobtread_job_id: string | null };
type MemberRow = { user_id: string; profiles: Member; projects: ProjectRow };

const daysBefore = (day: string, n: number) => new Date(Date.parse(`${day}T12:00:00Z`) - n * 86400_000).toISOString().slice(0, 10);
const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

async function constructionMembers(admin: Admin) {
  const { data } = await admin
    .from("project_members")
    .select("user_id, profiles!inner(id, full_name, email, role), projects!inner(id, name, town, phase, jobtread_job_id)")
    .eq("profiles.role", "construction");
  const byProject = new Map<string, { project: ProjectRow; members: Member[] }>();
  for (const r of (data ?? []) as unknown as MemberRow[]) {
    const e = byProject.get(r.projects.id) ?? { project: r.projects, members: [] };
    e.members.push(r.profiles);
    byProject.set(r.projects.id, e);
  }
  for (const e of byProject.values()) e.members.sort((a, b) => (a.full_name || a.email).localeCompare(b.full_name || b.email));
  return byProject;
}

function pickOwner(
  projectId: string,
  members: Member[],
  jobs: string[],
  chosen: Record<string, string>,
  tally: Record<string, Record<string, number>> | null,
): LogOwner | null {
  if (!members.length) return null;
  const set = chosen[projectId];
  if (set && members.some((m) => m.id === set)) return { userId: set, how: "chosen" };
  if (members.length === 1) return { userId: members[0].id, how: "only" };
  const counts = new Map<string, number>();
  for (const job of jobs) for (const [author, n] of Object.entries(tally?.[job] ?? {})) counts.set(norm(author), (counts.get(norm(author)) ?? 0) + n);
  let best: Member | null = null;
  let bestN = 0;
  for (const m of members) {
    const n = counts.get(norm(m.full_name || "")) ?? 0;
    if (n > bestN) [best, bestN] = [m, n];
  }
  return best ? { userId: best.id, how: "logs" } : { userId: members[0].id, how: "guess" };
}

async function chosenOwners(admin: Admin) {
  const { data } = await admin.from("app_settings").select("key, value").like("key", "dailylog:%");
  return Object.fromEntries((data ?? []).map((r) => [String(r.key).slice("dailylog:".length), String(r.value)]));
}

// Each job in construction → who's responsible for its daily log (for Team & Access).
export async function dailyLogOwners(admin: Admin, day = njNow().day) {
  const byProject = await constructionMembers(admin);
  const projects = [...byProject.values()].map((e) => e.project);
  const [check, chosen, tally] = await Promise.all([
    constructionCheck(projects),
    chosenOwners(admin),
    logAuthorsSince(daysBefore(day, 30)).catch(() => null),
  ]);
  const out: Record<string, LogOwner & { members: Member[] }> = {};
  for (const [id, e] of byProject) {
    if (!check.inConstruction(e.project)) continue;
    const owner = pickOwner(id, e.members, check.jobsFor(e.project), chosen, tally);
    if (owner) out[id] = { ...owner, members: e.members };
  }
  return out;
}

// jobtreadOk is false when JobTread couldn't be reached, so daily logs may be
// missing from the lists (reminder emails aren't sent then).
export async function loadChecklistStatus(admin: Admin, day: string, onlyUser?: string): Promise<{ people: PersonChecklist[]; jobtreadOk: boolean }> {
  let jobtreadOk = true;
  const [byProject, logs, chosen, tally] = await Promise.all([
    constructionMembers(admin),
    logsOn(day).catch(() => ((jobtreadOk = false), [])),
    chosenOwners(admin),
    logAuthorsSince(daysBefore(day, 30)).catch(() => ((jobtreadOk = false), null)),
  ]);
  const check = await constructionCheck([...byProject.values()].map((e) => e.project));
  if (!check.ok) jobtreadOk = false;
  const people = new Map<string, PersonChecklist>();
  for (const [id, { project: p, members }] of byProject) {
    if (!check.inConstruction(p)) continue;
    const jobs = check.jobsFor(p);
    const owner = pickOwner(id, members, jobs, chosen, tally);
    if (!owner || (onlyUser && owner.userId !== onlyUser)) continue;
    const m = members.find((x) => x.id === owner.userId)!;
    const person = people.get(m.id) ?? { userId: m.id, name: m.full_name || m.email, email: m.email, items: [] };
    const log = logs.filter((l) => jobs.includes(l.jobId)).sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
    person.items.push({
      projectId: p.id,
      name: p.name,
      town: p.town,
      phase: p.phase,
      linked: !!p.jobtread_job_id,
      done: log ? { by: "log", author: log.author, at: log.createdAt } : null,
    });
    people.set(m.id, person);
  }
  for (const p of people.values()) p.items.sort((a, b) => Number(!!a.done) - Number(!!b.done) || a.name.localeCompare(b.name));
  return { people: [...people.values()].sort((a, b) => a.name.localeCompare(b.name)), jobtreadOk };
}

// ---- Reminder emails ----------------------------------------------------------

const dayLabel = (day: string) =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });

const jobList = (items: CheckItem[]) =>
  items
    .map(
      (i) => `<tr><td style="padding:10px 0;border-top:1px solid #DCE3DF;font-size:14.5px">
        <b>${esc(i.name)}</b>${i.town ? ` <span style="color:#5D6A64">· ${esc(i.town)}</span>` : ""}${
          i.linked || i.done ? "" : `<br><span style="font-size:12.5px;color:#9C7740">Not linked to JobTread, so its daily log can't be found. Ask Julia to link it.</span>`
        }
        <span style="float:right;font-size:13px;color:${i.done ? "#455C51" : "#9F2A1E"};font-weight:bold">${i.done ? "Logged" : "Missing"}</span>
      </td></tr>`,
    )
    .join("");

const button = (label: string) =>
  `<p style="margin:18px 0 0"><a href="${HQ_URL}" style="display:inline-block;background:#455C51;color:#FFFFFF;text-decoration:none;font-weight:bold;font-size:14px;padding:11px 18px;border-radius:999px">${esc(label)}</a></p>`;

const FOOTER = "A job checks off on its own once JobTread has its daily log for today, and Beshara HQ shows it right away. You only get these emails while a job's log is missing.";

// 10 AM: every job not checked yet today.
function morningEmail(p: PersonChecklist, day: string) {
  const first = p.name.split(" ")[0] || "there";
  const open = p.items.filter((i) => !i.done);
  return {
    subject: `Today's daily logs · ${dayLabel(day)} · ${open.length} to write`,
    html: brandEmail({
      tag: "Daily Check-In",
      heading: `Good morning, ${first}`,
      body: `<p style="margin:0 0 12px;font-size:15px;line-height:1.5">Here ${open.length === 1 ? "is the job" : "are the jobs"} that need${open.length === 1 ? "s" : ""} a daily log in JobTread today, ${esc(dayLabel(day))}, even the quiet ones. Each checks off on its own once the log is in.</p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${jobList(open)}</table>${button("Open My Check-In")}`,
      footer: FOOTER,
    }),
  };
}

// 5 PM: whatever is still missing a check.
function afternoonEmail(p: PersonChecklist, day: string) {
  const open = p.items.filter((i) => !i.done);
  const first = p.name.split(" ")[0] || "there";
  return {
    subject: `${open.length} daily log${open.length === 1 ? "" : "s"} missing today · ${open.map((i) => i.name).slice(0, 2).join(", ")}${open.length > 2 ? "…" : ""}`,
    html: brandEmail({
      tag: "Daily Check-In",
      heading: `${first}, ${open.length === 1 ? "one daily log is" : `${open.length} daily logs are`} still missing`,
      body: `<p style="margin:0 0 12px;font-size:15px;line-height:1.5">It's 5 PM and these are still missing today's daily log in JobTread:</p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${jobList(open)}</table>
        <p style="margin:14px 0 0;font-size:14px;line-height:1.5;color:#5D6A64">Even if nothing happened on a site, write a short log saying so.</p>${button("Open My Check-In")}`,
      footer: FOOTER,
    }),
  };
}

function teamEmail(name: string, open: PersonChecklist[], day: string) {
  const count = open.reduce((n, p) => n + p.items.filter((i) => !i.done).length, 0);
  const sections = open
    .map(
      (p) => `<p style="margin:16px 0 4px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#9C7740;font-weight:bold">${esc(p.name)}</p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${jobList(p.items.filter((i) => !i.done))}</table>`,
    )
    .join("");
  return {
    subject: `${count} daily log${count === 1 ? "" : "s"} missing today`,
    html: brandEmail({
      tag: "Daily Check-In",
      heading: `Hi ${name.split(" ")[0] || "there"}, ${count === 1 ? "one job is" : `${count} jobs are`} missing today's daily log`,
      body: `<p style="margin:0;font-size:15px;line-height:1.5">As of 5 PM on ${esc(dayLabel(day))}, these are missing today's daily log in JobTread:</p>${sections}${
        open.some((p) => p.items.some((i) => !i.done && !i.linked))
          ? `<p style="margin:14px 0 0;font-size:14px;line-height:1.5;color:#5D6A64">Jobs marked "Not linked to JobTread" can be linked on the Jobs page in Beshara Reports, so their daily logs check them off.</p>`
          : ""
      }${button("Open Team Board")}`,
      footer: "You're getting this as the Principal Contractor or an Admin. Each PM also got their own reminder.",
    }),
  };
}

// Sends one round of reminders; each person gets each slot at most once a day.
export async function sendReminders(admin: Admin, day: string, slot: "morning" | "afternoon") {
  const { people: lists, jobtreadOk } = await loadChecklistStatus(admin, day);
  // Without JobTread every job would look unlogged; better no email than a wrong one.
  if (!jobtreadOk) {
    console.error(`Daily Check-In ${slot} reminders skipped: JobTread couldn't be reached.`);
    return [];
  }
  const sent: string[] = [];
  const claim = async (userId: string) => {
    const { data } = await admin.from("checklist_emails").upsert({ day, slot, user_id: userId }, { onConflict: "day,slot,user_id", ignoreDuplicates: true }).select("user_id");
    return !!data?.length;
  };
  for (const p of lists) {
    const open = p.items.filter((i) => !i.done);
    if (!open.length) continue; // only email about jobs still missing a check
    if (!(await claim(p.userId))) continue;
    const mail = slot === "morning" ? morningEmail(p, day) : afternoonEmail(p, day);
    const r = await sendEmail(p.email, mail.subject, mail.html);
    if (r.ok) sent.push(p.email);
  }
  if (slot === "afternoon") {
    const open = lists.filter((p) => p.items.some((i) => !i.done));
    if (open.length) {
      const { data: bosses } = await admin.from("profiles").select("id, full_name, email").in("role", ["owner", "admin"]);
      for (const b of bosses ?? []) {
        if (!(await claim(b.id))) continue;
        const mail = teamEmail(b.full_name || b.email, open, day);
        const r = await sendEmail(b.email, mail.subject, mail.html);
        if (r.ok) sent.push(b.email);
      }
    }
  }
  return sent;
}
