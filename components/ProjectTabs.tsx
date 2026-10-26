"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChatIcon, DocIcon } from "./Icons";

export default function ProjectTabs({ projectId, fileCount }: { projectId: string; fileCount: number }) {
  const path = usePathname();
  const onFiles = path.endsWith("/files");
  const onPeople = path.endsWith("/people");
  return (
    <div className="tabs" role="tablist">
      <Link className="tab" role="tab" href={`/projects/${projectId}`} aria-selected={!onFiles && !onPeople}>
        <ChatIcon /> Chat
      </Link>
      <Link className="tab" role="tab" href={`/projects/${projectId}/files`} aria-selected={onFiles}>
        <DocIcon /> Files <span className="count">{fileCount}</span>
      </Link>
    </div>
  );
}
