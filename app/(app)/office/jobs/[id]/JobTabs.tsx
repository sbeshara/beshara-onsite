"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function JobTabs({ id }: { id: string }) {
  const path = usePathname();
  const base = `/office/jobs/${id}`;
  const tabs = [
    { href: base, label: "Details", on: path === base },
    { href: `${base}/estimates`, label: "Estimates", on: path.startsWith(`${base}/estimates`) },
    { href: `${base}/plans`, label: "Plans & Takeoff", on: path.startsWith(`${base}/plans`) },
  ];
  return (
    <nav className="tabs jobtabs" aria-label="Job sections">
      {tabs.map((t) => (
        <Link key={t.href} className="tab" href={t.href} aria-current={t.on ? "page" : undefined}>{t.label}</Link>
      ))}
      <Link className="tab" href={`/projects/${id}`}>OnSite project ↗</Link>
    </nav>
  );
}
