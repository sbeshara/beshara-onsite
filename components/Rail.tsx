"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { PHASES } from "@/lib/constants";
import { DocIcon, GridIcon, PeopleIcon, UploadIcon } from "./Icons";

type P = { id: string; name: string; town: string; phase: number };

// The team sees projects grouped by phase, jobs in construction first.
const GROUP_ORDER = [2, 3, 1, 0, 4];

// Side menu: Dashboard, then Projects (grouped by phase for the team), then
// the team's tools, which stay pinned at the bottom while projects scroll.
// The logo in the header goes to Beshara HQ.
export default function Rail({ projects, isClient, isAdmin, unread }: { projects: P[]; isClient: boolean; isAdmin: boolean; unread: string[] }) {
  const path = usePathname();
  const heading = isClient ? (projects.length > 1 ? "Your Projects" : "Your Project") : isAdmin ? "All Projects" : "Your Projects";
  const grouped = !isClient && projects.length > 3;
  const link = (p: P, showPhase: boolean) => {
    const current = path.startsWith(`/projects/${p.id}`);
    return (
      <Link key={p.id} className="proj" href={`/projects/${p.id}`} aria-current={current ? "page" : undefined}>
        <span className={`pdot ph${p.phase}`} aria-hidden="true" />
        <span className="n">{p.name}</span>
        {unread.includes(p.id) && !current ? <span className="newb" aria-label="New messages">New</span> : <span />}
        {(p.town || showPhase) && <span className="m">{[p.town, showPhase ? PHASES[p.phase] : ""].filter(Boolean).join(" · ")}</span>}
      </Link>
    );
  };
  return (
    <nav className="panel rail" aria-label="Main">
      <div className="rail-sec">
        <Link className="navi" href="/" aria-current={path === "/" ? "page" : undefined}>
          <GridIcon /> {isClient ? "Home" : "Dashboard"}
        </Link>
      </div>

      <div className="rail-sec rail-projects">
        <div className="rail-h">
          <h2>{heading}</h2>
          {!isClient && <span className="rail-count">{projects.length}</span>}
        </div>
        <div className="rail-scroll">
          {grouped
            ? GROUP_ORDER.map((ph) => {
                const list = projects.filter((p) => p.phase === ph);
                if (!list.length) return null;
                return (
                  <details key={ph} className={`pgroup ph${ph}`} open={ph !== 4 || list.some((p) => path.startsWith(`/projects/${p.id}`))}>
                    <summary>
                      <span>{PHASES[ph]}</span>
                      <span className="pg-count">{list.length}</span>
                    </summary>
                    {list.map((p) => link(p, false))}
                  </details>
                );
              })
            : projects.map((p) => link(p, true))}
          {projects.length === 0 && <p className="upl" style={{ padding: "4px 16px" }}>No projects yet.</p>}
          {isAdmin && (
            <Link className="navi newp" href="/projects/new" aria-current={path === "/projects/new" ? "page" : undefined}>
              + New Project
            </Link>
          )}
        </div>
      </div>

      {!isClient && (
        <div className="rail-sec rail-tools">
          <h2>Manage</h2>
          <a className="navi" href={process.env.NEXT_PUBLIC_REPORTS_URL ?? "https://reports.besharabuilders.com"} target="_blank" rel="noreferrer">
            <DocIcon /> Progress Reports <span className="navi-ext">↗</span>
          </a>
          {isAdmin && (
            <Link className="navi" href="/team" aria-current={path === "/team" ? "page" : undefined}>
              <PeopleIcon /> Team &amp; Access
            </Link>
          )}
          {isAdmin && (
            <Link className="navi" href="/basecamp" aria-current={path === "/basecamp" ? "page" : undefined}>
              <UploadIcon /> Basecamp Import
            </Link>
          )}
        </div>
      )}
    </nav>
  );
}
