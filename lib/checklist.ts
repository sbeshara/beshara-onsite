import "server-only";
import { HQ_URL } from "./apps";
import { TZ } from "./format";
import { listOpenJobs, logsOn, type DayLog } from "./jobtread";
import { brandEmail, escapeHtml as esc, sendEmail } from "./notify";
import { createAdminClient } from "./supabase/admin";

type Admin = ReturnType<typeof createAdminClient>;

// The daily job checklist for Construction Management. Only jobs in
// construction are on it: a job linked to JobTread while its Status there is
// Construction, an unlinked job while its OnSite phase is Construction. A job
// is done for the day when JobTread has a daily log for it, or when the PM
// ticks it by hand.

const CONSTRUCTION_PHASE = 2;

export type CheckItem = {
  projectId: string;
  name: string;
  town: string;
  phase: number;
  linked: boolean; // has a JobTread job, so daily logs can check it off
  done: null | { by: "log"; author: string; at: string } | { by: "manual"; note: string; at: string };
};
export type PersonChecklist = { userId: string; name: string; email: string; items: CheckItem[] };

export function njNow(now = new Date()) {
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
  let q = admin
    .from("project_members")
    .select("user_id, profiles!inner(id, full_name, email, role), projects!inner(id, name, town, phase, jobtread_job_id)")
    .eq("profiles.role", "construction");
  if (onlyUser) q = q.eq("user_id", onlyUser);
  const [{ data: rows }, { data: checks }, logs] = await Promise.all([
    q,
    admin.from("daily_checks").select("project_id, user_id, note, checked_at").eq("day", day),
    logsOn(day).catch(() => [] as DayLog[]),
  ]);
  // JobTread jobs whose Status is Construction (null if JobTread can't be reached).
  const inConstruction = await listOpenJobs()
    .then((jobs) => new Set(jobs.map((j) => j.id)))
    .catch(() => null);
  const onChecklist = (p: { phase: number; jobtread_job_id: string | null }) =>
    p.jobtread_job_id && inConstruction ? inConstruction.has(p.jobtread_job_id) : p.phase === CONSTRUCTION_PHASE;
  type Row = {
    user_id: string;
    profiles: { id: string; full_name: string; email: string };
    projects: { id: string; name: string; town: string; phase: number; jobtread_job_id: string | null };
  };
  const people = new Map<string, PersonChecklist>();
  for (const r of (rows ?? []) as unknown as Row[]) {
    if (!onChecklist(r.projects)) continue;
    const person = people.get(r.user_id) ?? { userId: r.user_id, name: r.profiles.full_name || r.profiles.email, email: r.profiles.email, items: [] };
    const p = r.projects;
    const log = p.jobtread_job_id ? logs.filter((l) => l.jobId === p.jobtread_job_id).sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0] : undefined;
    const tick = (checks ?? []).find((c) => c.project_id === p.id && c.user_id === r.user_id);
    person.items.push({
      projectId: p.id,
      name: p.name,
      town: p.town,
      phase: p.phase,
      linked: !!p.jobtread_job_id,
      done: log ? { by: "log", author: log.author, at: log.createdAt } : tick ? { by: "manual", note: tick.note, at: tick.checked_at } : null,
    });
    people.set(r.user_id, person);
  }
  for (const p of people.values()) p.items.sort((a, b) => Number(!!a.done) - Number(!!b.done) || a.name.localeCompare(b.name));
  return [...people.values()].sort((a, b) => a.name.localeCompare(b.name));
}

// ---- Reminder emails ----------------------------------------------------------

const dayLabel = (day: string) =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });

const jobList = (items: CheckItem[]) =>
  items
    .map(
      (i) => `<tr><td style="padding:10px 0;border-top:1px solid #DCE3DF;font-size:14.5px">
        <b>${esc(i.name)}</b>${i.town ? ` <span style="color:#5D6A64">· ${esc(i.town)}</span>` : ""}
        <span style="float:right;font-size:13px;color:${i.done ? "#455C51" : "#9F2A1E"};font-weight:bold">${i.done ? "Done" : "Open"}</span>
      </td></tr>`,
    )
    .join("");

const button = (label: string) =>
  `<p style="margin:18px 0 0"><a href="${HQ_URL}" style="display:inline-block;background:#455C51;color:#FFFFFF;text-decoration:none;font-weight:bold;font-size:14px;padding:11px 18px;border-radius:999px">${esc(label)}</a></p>`;

const FOOTER = "A job is checked off when a daily log is posted for it in JobTread, or when you tick it on Beshara HQ. You only get these emails when a job still needs a check.";

// 10 AM: every job not checked yet today.
function morningEmail(p: PersonChecklist, day: string) {
  const first = p.name.split(" ")[0] || "there";
  const open = p.items.filter((i) => !i.done);
  return {
    subject: `Today's jobs to check · ${dayLabel(day)} · ${open.length} open`,
    html: brandEmail({
      tag: "Daily Checklist",
      heading: `Good morning, ${first}`,
      body: `<p style="margin:0 0 12px;font-size:15px;line-height:1.5">These job${open.length === 1 ? " hasn't" : "s haven't"} been checked yet for ${esc(dayLabel(day))}. Check in on each one today, even the quiet ones.</p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${jobList(open)}</table>${button("Open My Checklist")}`,
      footer: FOOTER,
    }),
  };
}

// 5 PM: whatever is still missing a check.
function afternoonEmail(p: PersonChecklist, day: string) {
  const open = p.items.filter((i) => !i.done);
  const first = p.name.split(" ")[0] || "there";
  return {
    subject: `${open.length} job${open.length === 1 ? "" : "s"} still open today · ${open.map((i) => i.name).slice(0, 2).join(", ")}${open.length > 2 ? "…" : ""}`,
    html: brandEmail({
      tag: "Daily Checklist",
      heading: `${first}, ${open.length === 1 ? "one job is" : `${open.length} jobs are`} still open`,
      body: `<p style="margin:0 0 12px;font-size:15px;line-height:1.5">It's 5 PM and these still have no daily log or check-off today:</p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${jobList(open)}</table>
        <p style="margin:14px 0 0;font-size:14px;line-height:1.5;color:#5D6A64">If nothing happened on a site, tick it on HQ with a quick note so the team knows it was looked at.</p>${button("Check Them Off")}`,
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
    subject: `${count} job${count === 1 ? "" : "s"} not checked off yet today`,
    html: brandEmail({
      tag: "Daily Checklist",
      heading: `Hi ${name.split(" ")[0] || "there"}, ${count === 1 ? "one job hasn't" : `${count} jobs haven't`} been checked today`,
      body: `<p style="margin:0;font-size:15px;line-height:1.5">As of 5 PM on ${esc(dayLabel(day))}, these have no daily log or check-off:</p>${sections}${button("Open Team Board")}`,
      footer: "You're getting this as the Principal Contractor or an Admin. Each PM also got their own reminder.",
    }),
  };
}

// Sends one round of reminders; each person gets each slot at most once a day.
export async function sendReminders(admin: Admin, day: string, slot: "morning" | "afternoon") {
  const lists = await loadChecklists(admin, day);
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
