import { getMe } from "@/lib/auth";
import { TEAM_APPS, type TeamApp } from "@/lib/apps";
import { greeting, todayLabel } from "@/lib/format";
import { lastFullWeek } from "@/lib/reports";
import { createClient } from "@/lib/supabase/server";
import { isTeamRole } from "@/lib/types";
import { roleLabel } from "@/lib/constants";
import "./hq.css";

export const metadata = { title: "Beshara HQ" };

const ICONS: Record<TeamApp["icon"], React.ReactNode> = {
  chat: <path d="M4 5h16v11H9l-5 4V5z" />,
  report: <path d="M6 3h9l4 4v14H6V3zm9 0v4h4M9 12h7M9 16h7M9 8h3" />,
  hammer: <path d="M14 4l6 6-3 3-6-6 3-3zm-3 3L3 15l3 3 8-8" />,
  people: <path d="M9 11a3 3 0 100-6 3 3 0 000 6zm-6 9c0-3.3 2.7-6 6-6s6 2.7 6 6M16 11a3 3 0 100-6M18 20c0-2.4-1.3-4.5-3.2-5.4" />,
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
  const [{ data: unread }, { count: toReview }] = await Promise.all([
    supabase.rpc("my_unread"),
    supabase.from("weekly_reports").select("id", { count: "exact", head: true }).eq("week_start", lastFullWeek()).eq("status", "draft"),
  ]);
  const unreadCount = ((unread ?? []) as { unread: number }[]).reduce((n, r) => n + Number(r.unread), 0);
  const stats: Record<string, { text: string; hot: boolean }> = {
    onsite: unreadCount ? { text: `${unreadCount} unread message${unreadCount === 1 ? "" : "s"}`, hot: true } : { text: "All caught up", hot: false },
    reports: toReview ? { text: `${toReview} report${toReview === 1 ? "" : "s"} to review`, hot: true } : { text: "Nothing waiting", hot: false },
  };
  const apps = TEAM_APPS.filter((a) => !a.roles || a.roles.includes(me.role));
  const first = (me.full_name || me.email).split(" ")[0];

  return (
    <div className="hq">
      <header className="hq-top">
        <span className="logo" aria-label="Beshara Builders" />
        <span className="hq-name">HQ</span>
        <span className="hq-sp" />
        <a href="/account" className="hq-me">{me.full_name || me.email}</a>
        <form action="/auth/signout" method="post">
          <button className="signout" type="submit">Sign out</button>
        </form>
      </header>
      <main className="hq-main">
        <div className="hq-hello">
          <p className="hq-date">{todayLabel()}</p>
          <h1>
            {greeting()}, <em>{first}</em>
          </h1>
          <p className="hq-role">{roleLabel(me)} · Beshara Builders</p>
        </div>
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
            <span className="hq-t">More coming</span>
            <span className="hq-b">New Beshara tools will show up here.</span>
          </div>
        </nav>
      </main>
    </div>
  );
}
