"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookIcon, ChatIcon, DocIcon, HardHatIcon } from "./Icons";

// Chat and Files for everyone on the project. The team also gets Plans &
// Takeoff and the job's proposals (the office opens the estimates; PMs see
// the scope without any numbers). Clients never see those two.
export default function ProjectTabs({ projectId, fileCount, team = false, office = false, proposals = 0 }: { projectId: string; fileCount: number; team?: boolean; office?: boolean; proposals?: number }) {
  const path = usePathname();
  const on = (seg: string) => path.endsWith(`/${seg}`);
  const onChat = !["files", "people", "plans", "scope", "proposals"].some(on);
  return (
    <div className="tabs" role="tablist">
      <Link className="tab" role="tab" href={`/projects/${projectId}`} aria-selected={onChat}>
        <ChatIcon /> Chat
      </Link>
      <Link className="tab" role="tab" href={`/projects/${projectId}/files`} aria-selected={on("files")}>
        <DocIcon /> Files <span className="count">{fileCount}</span>
      </Link>
      {!team && proposals > 0 && (
        <Link className="tab" role="tab" href={`/projects/${projectId}/proposals`} aria-selected={on("proposals")}>
          <BookIcon /> Proposals <span className="count">{proposals}</span>
        </Link>
      )}
      {team && (
        <Link className="tab" role="tab" href={`/projects/${projectId}/plans`} aria-selected={on("plans")}>
          <HardHatIcon /> Plans &amp; Takeoff
        </Link>
      )}
      {team && (
        <Link className="tab" role="tab" href={office ? `/office/jobs/${projectId}/estimates` : `/projects/${projectId}/scope`} aria-selected={on("scope")}>
          <BookIcon /> {office ? "Estimates" : "Scope"}
        </Link>
      )}
    </div>
  );
}
