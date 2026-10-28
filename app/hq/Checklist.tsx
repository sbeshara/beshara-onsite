"use client";

import { useState, useTransition } from "react";
import type { CheckItem } from "@/lib/checklist";
import { checkJob, uncheckJob, type Result } from "./actions";

const time = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" });

// A PM's jobs for today. Daily logs in JobTread check a job off on their own;
// anything else gets ticked here with an optional note.
export default function Checklist({ items, site }: { items: CheckItem[]; site: string }) {
  const [open, setOpen] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<Result>({});
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<Result>) =>
    start(async () => {
      const r = await fn();
      setMsg(r);
      if (r.ok) {
        setOpen(null);
        setNote("");
      }
    });
  const done = items.filter((i) => i.done).length;

  return (
    <section className="ck">
      <div className="ck-h">
        <h2>Today&apos;s Jobs</h2>
        <span className={`ck-count ${done === items.length ? "all" : ""}`}>
          {done} of {items.length} Checked
        </span>
      </div>
      <ul className="ck-list">
        {items.map((i) => (
          <li key={i.projectId} className={i.done ? "done" : ""}>
            <span className={`ck-box ${i.done ? "on" : ""}`} aria-hidden="true">
              {i.done ? "✓" : ""}
            </span>
            <div className="ck-main">
              <a className="ck-name" href={`${site}/projects/${i.projectId}`}>
                <span className={`pdot ph${i.phase}`} aria-hidden="true" /> {i.name}
              </a>
              <span className="ck-sub">
                {i.done?.by === "log" && <>Daily log by {i.done.author || "the team"} · {time(i.done.at)}</>}
                {i.done?.by === "manual" && <>Checked by you · {time(i.done.at)}{i.done.note ? ` · “${i.done.note}”` : ""}</>}
                {!i.done && (i.linked ? "No daily log yet today" : "Not linked to JobTread, so tick it when you've checked in")}
              </span>
              {open === i.projectId && (
                <div className="ck-note">
                  <input
                    autoFocus
                    maxLength={300}
                    placeholder="Optional note, e.g. Called the sub, no work today"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && run(() => checkJob(i.projectId, note))}
                  />
                  <button type="button" className="btn" disabled={pending} onClick={() => run(() => checkJob(i.projectId, note))}>
                    {pending ? "Saving…" : "Check Off"}
                  </button>
                  <button type="button" className="btn ghost" disabled={pending} onClick={() => setOpen(null)}>
                    Cancel
                  </button>
                </div>
              )}
            </div>
            {!i.done && open !== i.projectId && (
              <button type="button" className="linkbtn" onClick={() => { setOpen(i.projectId); setNote(""); setMsg({}); }}>
                Check Off
              </button>
            )}
            {i.done?.by === "manual" && (
              <button type="button" className="linkbtn" disabled={pending} onClick={() => run(() => uncheckJob(i.projectId))}>
                Undo
              </button>
            )}
          </li>
        ))}
      </ul>
      {msg.error && <p className="err">{msg.error}</p>}
      <p className="fine">Posting a daily log in JobTread checks a job off automatically. Reminders go out at 10 AM and 5 PM, only for jobs still unchecked.</p>
    </section>
  );
}
