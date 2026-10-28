import Link from "next/link";
import { getMe } from "@/lib/auth";
import { fileUrls } from "@/lib/jobtread";
import { addDays, lastFullWeek, shortDate, weekLabel, type WeeklyReport } from "@/lib/reports";
import { reportFileName } from "@/lib/report-pdf";
import { createClient } from "@/lib/supabase/server";
import { isAdminRole } from "@/lib/types";
import GenerateButton from "./GenerateButton";
import ReportEditor from "./ReportEditor";

export const maxDuration = 300;

const STATUS: Record<string, string> = {
  draft: "Ready to Review",
  pending: "Needs Looking Ahead",
  approved: "Posted",
  no_logs: "No Daily Logs",
  skipped: "Skipped",
  unlinked: "Not Linked",
  missing: "Not Drafted Yet",
  error: "Couldn't Draft",
};
const ORDER = ["pending", "draft", "error", "missing", "no_logs", "approved", "skipped", "unlinked"];

type Search = { week?: string; r?: string; posted?: string };

// One screen: the week's jobs on the left, the selected job's report on the right.
export default async function ReportsHome({ searchParams }: { searchParams: Promise<Search> }) {
  const me = await getMe();
  const admin = isAdminRole(me.role);
  const supabase = await createClient();
  const { week: wanted, r: selectedId, posted } = await searchParams;

  const [{ data: weeksData }, { data: projectsData }] = await Promise.all([
    supabase.from("weekly_reports").select("week_start").order("week_start", { ascending: false }).limit(200),
    supabase.from("projects").select("id, name, town, jobtread_job_id, jobtread_label").order("name"),
  ]);
  const weeks = [...new Set([lastFullWeek(), ...(weeksData ?? []).map((w) => w.week_start as string)])].sort().reverse().slice(0, 8);
  const week = wanted && /^\d{4}-\d{2}-\d{2}$/.test(wanted) ? wanted : weeks[0];
  const { data: reportsData } = await supabase.from("weekly_reports").select("*").eq("week_start", week);
  const reports = Object.fromEntries(((reportsData ?? []) as WeeklyReport[]).map((r) => [r.project_id, r]));

  const rows = (projectsData ?? [])
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
  const href = (r?: string) => `/studio?week=${week}${r ? `&r=${r}` : ""}`;
  // Where to go after approving or skipping: the next job still waiting.
  const nextUp = rows.find((x) => x.r && x.r.id !== selectedId && (x.status === "draft" || x.status === "pending"));

  let editor = null;
  if (selected?.r) {
    const report = selected.r;
    const ids = [report.updated_by, report.approved_by].filter(Boolean) as string[];
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
          <p>Week of {weekLabel(week)}</p>
        </div>
        <div className="st-weeks" aria-label="Week">
          {weeks.map((w) => (
            <Link key={w} href={`/studio?week=${w}`} className="chip" aria-pressed={w === week}>
              {shortDate(w).replace(/\/\d+$/, "")}
            </Link>
          ))}
        </div>
        <div className="st-sum">
          <span>{waiting} to Review</span>
          <span>{count("approved")} Posted</span>
        </div>
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
          {!rows.length && <div className="empty">No projects yet.</div>}
        </nav>
        {admin && count("missing") > 0 && <GenerateButton weekStart={week} />}
        <p className="fine">Drafts are written from JobTread daily logs every Monday at 8 AM. Next: Monday {shortDate(addDays(lastFullWeek(), 14))}.</p>
      </aside>
      <section className="st-detail">
        {posted && <div className="st-banner ok">Posted the {posted} report to the client&apos;s Progress Reports chat.</div>}
        {editor ?? (
          <div className="st-empty">
            <h2>{waiting ? "Pick a Job to Review" : "All Caught Up"}</h2>
            <p>
              {waiting
                ? `${waiting} report${waiting === 1 ? " is" : "s are"} waiting for the week of ${shortDate(week)}.`
                : `Nothing waiting for the week of ${shortDate(week)}.`}
            </p>
            {nextUp?.r && (
              <Link className="btn" href={href(nextUp.r.id)}>
                Start with {nextUp.p.name}
              </Link>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
