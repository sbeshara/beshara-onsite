import { getMe } from "@/lib/auth";
import { TEAM_APPS, type TeamApp } from "@/lib/apps";
import Link from "next/link";
import Hero from "@/components/Hero";
import { ChatIcon, DocIcon, GridIcon } from "@/components/Icons";
import { todayLabel } from "@/lib/format";
import { isWeekday, loadChecklists, njNow } from "@/lib/checklist";
import { lastFullWeek } from "@/lib/reports";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { isAdminRole, isTeamRole } from "@/lib/types";
import { ROLE_LABEL } from "@/lib/constants";
import Checklist from "./Checklist";
import TeamBoard from "./TeamBoard";
import "./hq.css";

export const metadata = { title: "Beshara HQ" };

const ICONS: Record<TeamApp["icon"], React.ReactNode> = {
  chat: <path d="M4 5h16v11H9l-5 4V5z" />,
  report: <path d="M6 3h9l4 4v14H6V3zm9 0v4h4M9 12h7M9 16h7M9 8h3" />,
  hammer: <path d="M14 4l6 6-3 3-6-6 3-3zm-3 3L3 15l3 3 8-8" />,
  people: <path d="M9 11a3 3 0 100-6 3 3 0 000 6zm-6 9c0-3.3 2.7-6 6-6s6 2.7 6 6M16 11a3 3 0 100-6M18 20c0-2.4-1.3-4.5-3.2-5.4" />,
  sheet: <path d="M4 4h16v16H4zM4 9.5h16M4 15h16M10 9.5V20" />,
  folder: <path d="M3 6.5h6l2 2h10V19H3z" />,
};

// Beshara HQ: the team's home screen, one tile per app.
export default async function HQ() {
  const me = await getMe();
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? "https://onsite.besharabuilders.com";
  if (!isTeamRole(me.role)) {
    return (
      <div className="hq-blocked">
        <h1>Beshara HQ is for the Beshara team.</h1>
        <p>Your project updates are in Beshara OnSite.</p>
        <a className="btn" href={site}>Open OnSite</a>
      </div>
    );
  }

  const supabase = await createClient();
  const [{ data: unread }, { count: toReview }, { count: projects }] = await Promise.all([
    supabase.rpc("my_unread"),
    supabase.from("weekly_reports").select("id", { count: "exact", head: true }).eq("week_start", lastFullWeek()).eq("status", "draft"),
    supabase.from("projects").select("id", { count: "exact", head: true }),
  ]);
  const unreadCount = ((unread ?? []) as { unread: number }[]).reduce((n, r) => n + Number(r.unread), 0);
  const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
  const stats: Record<string, { text: string; hot: boolean }> = {
    onsite: unreadCount ? { text: `${plural(unreadCount, "Unread Message")}`, hot: true } : { text: "All Caught Up", hot: false },
    reports: toReview ? { text: `${plural(toReview, "Report")} to Review`, hot: true } : { text: "Nothing Waiting", hot: false },
  };
  // Today's checklist: a PM's own jobs, or every PM's for the Principal Contractor and Admins.
  const today = njNow();
  const workday = isWeekday(today.weekday);
  const lists = workday ? await loadChecklists(createAdminClient(), today.day, isAdminRole(me.role) ? undefined : me.id) : [];
  const mine = me.role === "construction" ? (lists[0]?.items ?? []) : null;
  const mineOpen = mine ? mine.filter((i) => !i.done).length : 0;
  const apps = TEAM_APPS.filter((a) => !a.roles || a.roles.includes(me.role));
  const first = (me.full_name || me.email).split(" ")[0];

  return (
    <div className="hq">
      <header className="top">
        <Link href="/" className="logo" aria-label="Beshara HQ" />
        <span className="hub">HQ</span>
        <Link href="/account" className="userchip" title="Your account">
          <b>{me.full_name || me.email}</b>
          <small>{ROLE_LABEL[me.role]}</small>
        </Link>
        <form action="/auth/signout" method="post">
          <button className="signout" type="submit">Sign Out</button>
        </form>
      </header>
      <main className="hq-main">
        <Hero
          name={first}
          eyebrow={`Beshara HQ · ${todayLabel()}`}
          copy="Everything the Beshara team runs on, in one place: client conversations, progress reports and every job in JobTread."
        >
          <a className="feat" href={apps.find((a) => a.key === "onsite")?.url}>
            <ChatIcon />
            {unreadCount ? plural(unreadCount, "Unread Message") : "Messages All Caught Up"}
          </a>
          <a className="feat" href={apps.find((a) => a.key === "reports")?.url}>
            <DocIcon />
            {toReview ? `${plural(toReview, "Report")} to Review` : "No Reports Waiting"}
          </a>
          {mine && workday && mine.length ? (
            <a className="feat" href="#today">
              <GridIcon />
              {mineOpen ? `${plural(mineOpen, "Job")} to Check Today` : "All Jobs Checked Today"}
            </a>
          ) : (
            <span className="feat">
              <GridIcon />
              {plural(projects ?? 0, "Active Project")}
            </span>
          )}
        </Hero>
        {workday && mine && mine.length > 0 && (
          <div id="today">
            <Checklist items={mine} site={site} />
          </div>
        )}
        {workday && isAdminRole(me.role) && <TeamBoard lists={lists} site={site} />}
        <nav className="hq-grid" aria-label="Apps">
          {apps.map((a) => (
            <a key={a.key} className="hq-tile" href={a.url} {...(a.external ? { target: "_blank", rel: "noreferrer" } : {})}>
              <span className="hq-ic" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                  {ICONS[a.icon]}
                </svg>
              </span>
              <span className="hq-t">
                {a.name}
                {a.external && <span className="hq-ext"> ↗</span>}
              </span>
              <span className="hq-b">{a.blurb}</span>
              {stats[a.key] && <span className={`hq-stat ${stats[a.key].hot ? "hot" : ""}`}>{stats[a.key].text}</span>}
            </a>
          ))}
          <div className="hq-tile hq-soon" aria-hidden="true">
            <span className="hq-ic">+</span>
            <span className="hq-t">More Coming</span>
            <span className="hq-b">New Beshara tools will show up here.</span>
          </div>
        </nav>
      </main>
    </div>
  );
}
