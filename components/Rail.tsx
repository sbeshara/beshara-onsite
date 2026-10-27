"use client";

import { HQ_URL } from "@/lib/apps";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { PHASES } from "@/lib/constants";
import { GridIcon } from "./Icons";

type P = { id: string; name: string; town: string; phase: number };

export default function Rail({ projects, isClient, isAdmin, unread }: { projects: P[]; isClient: boolean; isAdmin: boolean; unread: string[] }) {
  const path = usePathname();
  return (
    <nav className="panel rail" aria-label="Main">
      <Link className="navi" href="/" aria-current={path === "/" ? "page" : undefined}>
        <GridIcon /> {isClient ? "Home" : "Dashboard"}
      </Link>
      <h2>{isClient ? (projects.length > 1 ? "Your projects" : "Your project") : isAdmin ? "All projects" : "Your projects"}</h2>
      {projects.map((p) => {
        const current = path.startsWith(`/projects/${p.id}`);
        return (
          <Link key={p.id} className="proj" href={`/projects/${p.id}`} aria-current={current ? "page" : undefined}>
            <span className="n">{p.name}</span>
            {unread.includes(p.id) && !current ? <span className="dot" aria-label="New messages" /> : <span />}
            <span className="m">
              {p.town ? `${p.town} · ` : ""}
              {PHASES[p.phase]}
            </span>
          </Link>
        );
      })}
      {projects.length === 0 && <p className="upl" style={{ padding: "4px 16px" }}>No projects yet.</p>}
      {!isClient && (
        <>
          <a className="navi" href={HQ_URL}>
            Beshara HQ
          </a>
          <a className="navi" href={process.env.NEXT_PUBLIC_REPORTS_URL ?? "https://reports.besharabuilders.com"} target="_blank" rel="noreferrer">
            Weekly reports ↗
          </a>
        </>
      )}
      {isAdmin && (
        <>
          <Link className="navi newp" href="/projects/new">+ New project</Link>
          <Link className="navi" href="/team" aria-current={path === "/team" ? "page" : undefined}>Team &amp; access</Link>
        </>
      )}
    </nav>
  );
}
