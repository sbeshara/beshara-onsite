import Link from "next/link";
import { getMe } from "@/lib/auth";
import { addDays, lastFullWeek, weekLabel, type WeeklyReport } from "@/lib/reports";
import { createClient } from "@/lib/supabase/server";
import { isAdminRole } from "@/lib/types";
import GenerateButton from "./GenerateButton";

export const maxDuration = 300;

const STATUS: Record<string, string> = { draft: "Needs review", pending: "Needs Looking Ahead from PM", approved: "Posted", no_logs: "No daily logs", skipped: "Skipped", unlinked: "Not linked", missing: "Not drafted yet" };

export default async function ReportsHome({ searchParams }: { searchParams: Promise<{ week?: string }> }) {
  const me = await getMe();
  const admin = isAdminRole(me.role);
  const supabase = await createClient();
  const [{ data: weeksData }, { data: projectsData }] = await Promise.all([
    supabase.from("weekly_reports").select("week_start").order("week_start", { ascending: false }).limit(200),
    supabase.from("projects").select("id, name, town, phase, jobtread_job_id, jobtread_label").order("name"),
  ]);
  const weeks = [...new Set([lastFullWeek(), ...(weeksData ?? []).map((w) => w.week_start as string)])].sort().reverse().slice(0, 8);
  const { week: wanted } = await searchParams;
  const week = wanted && /^\d{4}-\d{2}-\d{2}$/.test(wanted) ? wanted : weeks[0];
  const { data: reportsData } = await supabase.from("weekly_reports").select("*").eq("week_start", week);
  const reports = Object.fromEntries(((reportsData ?? []) as WeeklyReport[]).map((r) => [r.project_id, r]));
  const projects = projectsData ?? [];

  const rows = projects.map((p) => {
    const r = reports[p.id];
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
  });
  const order = ["draft", "pending", "error", "missing", "no_logs", "approved", "skipped", "unlinked"];
  rows.sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status));
  const count = (s: string) => rows.filter((r) => r.status === s).length;

  return (
    <>
      <div className="st-h">
        <div>
          <h1>Weekly progress reports</h1>
          <p>
            Week of {weekLabel(week)}. Drafts are written from JobTread daily logs every Monday at 8 AM. Review each one, then approve to post it to the
            client&apos;s Weekly Progress Report chat as Beshara Builders.
          </p>
        </div>
        {admin && <GenerateButton weekStart={week} />}
      </div>
      <div className="st-weeks" role="tablist" aria-label="Week">
        {weeks.map((w) => (
          <Link key={w} href={`/studio?week=${w}`} className="chip" aria-pressed={w === week}>
            {weekLabel(w).split(" - ")[0]}
          </Link>
        ))}
      </div>
      <div className="st-sum">
        <span>{count("draft")} need review</span>
        {count("pending") > 0 && <span>{count("pending")} waiting on the PM</span>}
        <span>{count("approved")} posted</span>
        {count("no_logs") > 0 && <span>{count("no_logs")} with no daily logs</span>}
        {count("error") > 0 && <span>{count("error")} couldn&apos;t be drafted</span>}
        {admin && count("unlinked") > 0 && <span>{count("unlinked")} not linked to JobTread</span>}
      </div>
      <div className="st-list">
        {rows
          .filter((r) => admin || r.status !== "unlinked")
          .map(({ p, r, status }) => {
            const body = (
              <>
                <div style={{ minWidth: 0 }}>
                  <h2>{p.name}</h2>
                  <div className="meta">
                    {[p.town, p.jobtread_label ? `JobTread ${p.jobtread_label.split(" · ")[0]}` : null, r?.approved_at ? `posted ${new Date(r.approved_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : null]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                </div>
                <span className={`st-status ${status}`}>{status === "error" ? "Couldn't draft" : STATUS[status]}</span>
                {r && status !== "no_logs" && r.completed.length > 0 && (
                  <div className="peek">{r.completed.map((c) => (c.trade ? `${c.trade}: ${c.text}` : c.text)).join(" · ")}</div>
                )}
                {r?.pm_notes ? <div className="peek">PM notes: {r.pm_notes}</div> : null}
                {status === "no_logs" && <div className="peek">No daily logs in JobTread for {weekLabel(week)}. Nothing will be posted unless you write one.</div>}
                {status === "unlinked" && <div className="peek">Link this project to its JobTread job on the JobTread jobs page.</div>}
              </>
            );
            return r ? (
              <Link key={p.id} className="st-card" href={`/studio/r/${r.id}`}>{body}</Link>
            ) : status === "unlinked" ? (
              <Link key={p.id} className="st-card" href="/studio/jobs">{body}</Link>
            ) : (
              <div key={p.id} className="st-card">{body}</div>
            );
          })}
        {!rows.length && <div className="empty">No projects yet.</div>}
      </div>
      <p className="fine">Next drafts: Monday {weekLabel(addDays(lastFullWeek(), 14)).split(" - ")[0]} at 8 AM, covering the week of {weekLabel(addDays(lastFullWeek(), 7))}.</p>
    </>
  );
}
