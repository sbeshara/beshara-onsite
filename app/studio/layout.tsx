import Link from "next/link";
import { HQ_URL } from "@/lib/apps";
import { getMe } from "@/lib/auth";
import { isAdminRole, isTeamRole } from "@/lib/types";
import "./studio.css";

export const metadata = { title: "Beshara Reports" };

// Beshara Reports: the team's internal site for progress reports.
export default async function StudioLayout({ children }: { children: React.ReactNode }) {
  const me = await getMe();
  if (!isTeamRole(me.role)) {
    return (
      <div className="st-blocked">
        <h1>Beshara Reports is for the Beshara team.</h1>
        <p>Your project updates are in Beshara OnSite.</p>
        <a className="btn" href={process.env.NEXT_PUBLIC_SITE_URL ?? "/"}>Open OnSite</a>
      </div>
    );
  }
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? "/";
  return (
    <div className="st">
      <header className="top st-top">
        <a href={HQ_URL} className="logo" aria-label="Beshara HQ" />
        <span className="hub">Reports</span>
        <nav className="st-nav">
          <Link href="/studio">Progress Reports</Link>
          {isAdminRole(me.role) && <Link href="/studio/jobs">JobTread Jobs</Link>}
          <a href={site}>OnSite ↗</a>
        </nav>
        <span className="st-me">{me.full_name || me.email}</span>
      </header>
      <main className="st-main">{children}</main>
    </div>
  );
}
