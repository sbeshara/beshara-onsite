"use client";

import { useState, useTransition } from "react";
import type { JobOption } from "@/lib/jobtread";
import { importJobs, type Result } from "../actions";

// Construction jobs that aren't in OnSite yet; tick and add them in one go.
export default function ImportJobs({ jobs }: { jobs: JobOption[] }) {
  const [picked, setPicked] = useState<string[]>(jobs.filter((j) => !/^test$/i.test(j.client ?? "")).map((j) => j.id));
  const [msg, setMsg] = useState<Result>({});
  const [pending, start] = useTransition();
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  // Stays mounted after the last job is added so the confirmation still shows.
  if (!jobs.length) return msg.ok ? <div className="st-banner ok">{msg.ok}</div> : null;

  return (
    <section className="st-panel">
      <h2>Construction Jobs Not in OnSite Yet · {jobs.length}</h2>
      <p className="fine" style={{ margin: 0 }}>
        Each one becomes an OnSite project with its four starter chats, set to the Construction phase and linked here. Then open the project and
        invite the client from Team &amp; clients.
      </p>
      <div style={{ display: "grid", gap: 2 }}>
        {jobs.map((j) => (
          <label key={j.id} className="st-opt">
            <input type="checkbox" checked={picked.includes(j.id)} onChange={() => toggle(j.id)} disabled={pending} />
            <span>
              <b>{j.client ?? `Job ${j.number}`}</b> · JobTread {j.number}
              {j.town ? ` · ${j.town}` : ""}
            </span>
          </label>
        ))}
      </div>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <button type="button" className="btn" disabled={pending || !picked.length} onClick={() => start(async () => setMsg(await importJobs(picked)))}>
          {pending ? "Adding…" : `Add ${picked.length} to OnSite`}
        </button>
        {msg.error && <span className="err">{msg.error}</span>}
        {msg.ok && <span className="ok">{msg.ok}</span>}
      </div>
    </section>
  );
}
