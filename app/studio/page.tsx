import Link from "next/link";
import { getMe } from "@/lib/auth";
import { fileUrls } from "@/lib/jobtread";
import ReadyToSend from "@/components/ReadyToSend";
import { nextReportFriday, readyToSend, reportWeek, shortDate, weekLabel, type WeeklyReport } from "@/lib/reports";
import { reportFileName } from "@/lib/report-pdf";
import { createClient } from "@/lib/supabase/server";
import { isAdminRole } from "@/lib/types";
import GenerateButton from "./GenerateButton";
import ReportEditor from "./ReportEditor";

export const maxDuration = 300;

const STATUS: Record<string, string> = {
  draft: "Ready to Review",
  pending: "Needs Looking Ahead",
  approved: "Ready to Send",
  sent: "Sent",
  no_logs: "No Daily Logs",
  skipped: "Skipped",
  unlinked: "Not Linked",
  missing: "Not Drafted Yet",
  error: "Couldn't Draft",
};
const ORDER = ["pending", "draft", "error", "missing", "approved", "no_logs", "sent", "skipped", "unlinked"];

type Search = { week?: string; r?: string; posted?: string; approved?: string };

// One screen: the week's jobs on the left, the selected job's report on the right.
export default async function ReportsHome({ searchParams }: { searchParams: Promise<Search> }) {
  const me = await getMe();
  const admin = isAdminRole(me.role);
  const supabase = await createClient();
  const { week: wanted, r: selectedId, posted, approved } = await searchParams;

  const [{ data: weeksData }, { data: projectsData }, ready] = await Promise.all([
    supabase.from("weekly_reports").select("week_start").order("week_start", { ascending: false }).limit(200),
    supabase.from("projects").select("id, name, town, jobtread_job_id, jobtread_label").order("name"),
    readyToSend(supabase),
  ]);
  // Reports are open Friday through Monday; Tuesday to Thursday only past
  // weeks can be looked at.
  const open = reportWeek();
  const weeks = [...new Set([...(open ? [open] : []), ...(weeksData ?? []).map((w) => w.week_start as string)])].sort().reverse().slice(0, 8);
  const week = wanted && /^\d{4}-\d{2}-\d{2}$/.test(wanted) ? wanted : open;
  const pastWeek = !!week && week !== open;
  const { data: reportsData } = week ? await supabase.from("weekly_reports").select("*").eq("week_start", week) : { data: [] };
  const reports = Object.fromEntries(((reportsData ?? []) as WeeklyReport[]).map((r) => [r.project_id, r]));

  const rows = (week ? (projectsData ?? []) : [])
    .map((p) => {
      const r = reports[p.id] as WeeklyReport | undefined;
      const status = r
        ? r.error && !r.completed.length
          ? "error"
          : r.status === "draft" && !r.looking_ahead.length
            ? "pending"
            : r.status
        : p.jobtread_job_id
          ? "missing"
          : "unlinked";
      return { p, r, status };
    })
    .filter((x) => admin || x.status !== "unlinked")
    .sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status) || a.p.name.localeCompare(b.p.name));
  const count = (...s: string[]) => rows.filter((r) => s.includes(r.status)).length;
  const waiting = count("draft", "pending");

  const selected = rows.find((x) => x.r?.id === selectedId);
  const href = (r?: string) => (week ? `/studio?week=${week}${r ? `&r=${r}` : ""}` : "/studio");
  // Where to go after approving or skipping: the next job still waiting.
  const nextUp = rows.find((x) => x.r && x.r.id !== selectedId && (x.status === "draft" || x.status === "pending"));

  let editor = null;
  if (selected?.r) {
    const report = selected.r;
    const ids = [report.updated_by, report.approved_by, report.sent_by].filter(Boolean) as string[];
    const [{ data: people }, thumbs] = await Promise.all([
      supabase.from("profiles").select("id, full_name").in("id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]),
      fileUrls(report.photos.map((p) => p.id), 400).catch(() => ({}) as Record<string, string>),
    ]);
    const name = (uid: string | null) => people?.find((p) => p.id === uid)?.full_name ?? "";
    editor = (
      <ReportEditor
        key={`${report.id}-${report.generated_at}-${report.status}`}
        report={report}
        project={{ name: selected.p.name, town: selected.p.town, job: selected.p.jobtread_label?.split(" · ")[0] ?? null }}
        thumbs={thumbs}
        editedBy={name(report.updated_by)}
        approvedBy={name(report.approved_by)}
        sentBy={name(report.sent_by)}
        canSend={admin}
        canRedraft={!pastWeek}
        draftName={reportFileName(selected.p.name, shortDate(report.week_start), true)}
        nextHref={nextUp?.r ? href(nextUp.r.id) : href()}
        listHref={href()}
      />
    );
  }

  return (
    <div className="st-split" data-open={editor ? "" : undefined}>
      <aside className="st-side">
        <div className="st-side-h">
          <h1>Progress Reports</h1>
          <p>
            {week ? `Week of ${weekLabel(week)}${pastWeek ? " · Past Week" : ""}` : `Closed until Friday ${shortDate(nextReportFriday())} at 3 PM`}
          </p>
        </div>
        {weeks.length > 0 && (
        <div className="st-weeks" aria-label="Week">
          {weeks.map((w) => (
            <Link key={w} href={`/studio?week=${w}`} className="chip" aria-pressed={w === week}>
              {w === open ? "This Week" : shortDate(w).replace(/\/\d+$/, "")}
            </Link>
          ))}
        </div>
        )}
        {week && (
        <div className="st-sum">
          <span>{waiting} to Review</span>
          <span>{count("approved")} Ready to Send</span>
          <span>{count("sent")} Sent</span>
        </div>
        )}
        <nav className="st-jobs" aria-label="Jobs">
          {rows.map(({ p, r, status }) => {
            const body = (
              <>
                <span className="nm">{p.name}</span>
                <span className={`st-status ${status}`}>{STATUS[status]}</span>
                <span className="meta">{[p.town, p.jobtread_label ? `JobTread ${p.jobtread_label.split(" · ")[0]}` : null].filter(Boolean).join(" · ")}</span>
              </>
            );
            if (r)
              return (
                <Link key={p.id} href={href(r.id)} className="st-job" aria-current={r.id === selectedId ? "page" : undefined}>
                  {body}
                </Link>
              );
            if (status === "unlinked")
              return (
                <Link key={p.id} href="/studio/jobs" className="st-job">
                  {body}
                </Link>
              );
            return (
              <div key={p.id} className="st-job">
                {body}
              </div>
            );
          })}
          {week && !rows.length && <div className="empty">No projects yet.</div>}
        </nav>
        {admin && week && week === open && count("missing") > 0 && <GenerateButton weekStart={week} />}
        <p className="fine">
          Open Friday through Monday. Each job is drafted from its JobTread daily logs on Friday from 3 PM, as its Friday log comes in, and the rest
          Saturday at 8 AM. Reports are sent on Monday.
        </p>
      </aside>
      <section className="st-detail">
        {posted && <div className="st-banner ok">Sent the {posted} report to the client&apos;s Progress Reports chat.</div>}
        {approved && <div className="st-banner ok">Approved the {approved} report. It&apos;s in Ready to Send; nothing goes to the client until it&apos;s sent.</div>}
        {!editor && <ReadyToSend reports={ready} canSend={admin} />}
        {pastWeek && <div className="st-banner note">This is a past week, kept for reference. This week&apos;s reports open Friday afternoon.</div>}
        {!week && (
          <div className="st-empty">
            <h2>Progress Reports Open Friday</h2>
            <p>
              The next reports are drafted Friday {shortDate(nextReportFriday())} from 3 PM, reviewed over the weekend and sent on Monday.
              {weeks.length > 0 && " Past weeks are listed on the left for reference."}
            </p>
          </div>
        )}
        {week && (editor ?? (
          <div className="st-empty">
            <h2>{waiting ? "Pick a Job to Review" : "All Caught Up"}</h2>
            <p>
              {waiting
                ? `${waiting} report${waiting === 1 ? " is" : "s are"} waiting for the week of ${shortDate(week!)}.`
                : `Nothing waiting for the week of ${shortDate(week!)}.`}
            </p>
            {nextUp?.r && (
              <Link className="btn" href={href(nextUp.r.id)}>
                Start with {nextUp.p.name}
              </Link>
            )}
          </div>
        ))}
      </section>
    </div>
  );
}
