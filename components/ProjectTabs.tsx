"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookIcon, ChatIcon, DocIcon, HardHatIcon, PeopleIcon } from "./Icons";

// One page per job, with a tab for each part of it. Everyone on the project
// gets Chat and Files. The team also gets Plans & Takeoff. The office (Owner,
// Admin, Senior PM, Preconstruction Manager) gets Estimates, Invoicing and
// Details; PMs get Scope (proposals without numbers). Clients get Proposals
// once one has been sent.
export default function ProjectTabs({ projectId, fileCount, team = false, office = false, proposals = 0 }: { projectId: string; fileCount: number; team?: boolean; office?: boolean; proposals?: number }) {
  const path = usePathname();
  const base = `/projects/${projectId}`;
  const seg = path.slice(base.length).split("/")[1] ?? "";
  const tab = (href: string, key: string, label: React.ReactNode, icon: React.ReactNode) => (
    <Link className="tab" role="tab" href={href} aria-selected={seg === key}>
      {icon} {label}
    </Link>
  );
  const onChat = seg === "" || seg === "chats";
  return (
    <div className="tabs" role="tablist" style={{ overflowX: "auto" }}>
      <Link className="tab" role="tab" href={base} aria-selected={onChat}>
        <ChatIcon /> Chat
      </Link>
      {tab(`${base}/files`, "files", <>Files <span className="count">{fileCount}</span></>, <DocIcon />)}
      {!team && proposals > 0 && tab(`${base}/proposals`, "proposals", <>Proposals <span className="count">{proposals}</span></>, <BookIcon />)}
      {office && tab(`${base}/estimates`, "estimates", "Estimates", <BookIcon />)}
      {team && !office && tab(`${base}/scope`, "scope", "Scope", <BookIcon />)}
      {team && tab(`${base}/plans`, "plans", "Plans & Takeoff", <HardHatIcon />)}
      {office && tab(`${base}/invoicing`, "invoicing", "Invoicing", <DocIcon />)}
      {office && tab(`${base}/details`, "details", "Details", <PeopleIcon />)}
    </div>
  );
}
