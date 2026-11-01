"use client";

import { useEffect, useState, useTransition } from "react";
import type { JobOption } from "@/lib/jobtread";
import { linkJob, type Result } from "../actions";

type Props = { projectId: string; current: string | null; currentLabel: string | null; jobs: (JobOption & { display?: string })[] };

export default function JobLinker({ projectId, current, currentLabel, jobs }: Props) {
  const [value, setValue] = useState(current ?? "");
  // Follow links changed elsewhere on the page (e.g. Link Check's Switch button).
  useEffect(() => setValue(current ?? ""), [current]);
  const [msg, setMsg] = useState<Result>({});
  const [pending, start] = useTransition();
  // Keep a linked job selectable even if it has since closed in JobTread.
  const options: { id: string; label: string; display?: string }[] =
    current && !jobs.some((j) => j.id === current) ? [{ id: current, label: currentLabel ?? current, display: `${currentLabel ?? current} · not Construction, Preconstruction or Approved` }, ...jobs] : jobs;

  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <select
        className="st-select"
        style={{ maxWidth: 420 }}
        aria-label="JobTread job"
        value={value}
        disabled={pending}
        onChange={(e) => {
          const id = e.target.value;
          setValue(id);
          const label = options.find((j) => j.id === id)?.label ?? null;
          start(async () => setMsg(await linkJob(projectId, id || null, id ? label : null)));
        }}
      >
        <option value="">Not Linked</option>
        {options.map((j) => (
          <option key={j.id} value={j.id}>{j.display ?? j.label}</option>
        ))}
      </select>
      {msg.error && <span className="err">{msg.error}</span>}
      {msg.ok && <span className="ok">{msg.ok}</span>}
    </div>
  );
}
