"use client";

import { useState, useTransition } from "react";
import type { CheckItem } from "@/lib/checklist";
import { checkJob, uncheckJob, type Result } from "./actions";

const time = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" });

// A PM's daily check-in: one box per active job, ticked once they've thought
// about it today. A JobTread daily log for the job ticks it automatically.
export default function Checklist({ items, site }: { items: CheckItem[]; site: string }) {
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<Result>({});
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<Result>, after?: () => void) =>
    start(async () => {
      const r = await fn();
      setMsg(r.error ? r : {});
      if (r.ok) after?.();
    });
  const done = items.filter((i) => i.done).length;

  return (
    <section className="ck">
      <div className="ck-h">
        <div>
          <h2>Daily Check-In</h2>
          <p className="ck-lead">Check in on every active job today, even the quiet ones.</p>
        </div>
        <span className={`ck-count ${done === items.length ? "all" : ""}`}>
          {done} of {items.length} Checked In
        </span>
      </div>
      <ul className="ck-list">
        {items.map((i) => (
          <li key={i.projectId} className={i.done ? "done" : ""}>
            <button
              type="button"
              className={`ck-box ${i.done ? "on" : ""}`}
              role="checkbox"
              aria-checked={!!i.done}
              aria-label={`Checked in on ${i.name}`}
              disabled={pending || i.done?.by === "log"}
              title={i.done?.by === "log" ? "Checked in by today's daily log" : undefined}
              onClick={() => (i.done ? run(() => uncheckJob(i.projectId)) : run(() => checkJob(i.projectId, ""), () => setNoteFor(i.projectId)))}
            >
              {i.done ? "✓" : ""}
            </button>
            <div className="ck-main">
              <a className="ck-name" href={`${site}/projects/${i.projectId}`}>
                <span className={`pdot ph${i.phase}`} aria-hidden="true" /> {i.name}
              </a>
              <span className="ck-sub">
                {i.done?.by === "log" && <>Checked in automatically · daily log by {i.done.author || "the team"} at {time(i.done.at)}</>}
                {i.done?.by === "manual" && <>Checked in at {time(i.done.at)}{i.done.note ? ` · “${i.done.note}”` : ""}</>}
                {!i.done && "Not checked in yet today"}
              </span>
              {noteFor === i.projectId && i.done?.by === "manual" && (
                <div className="ck-note">
                  <input
                    autoFocus
                    maxLength={300}
                    placeholder="Add a note (optional), e.g. Called the sub, no work today"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && run(() => checkJob(i.projectId, note), () => { setNoteFor(null); setNote(""); })}
                  />
                  <button type="button" className="btn" disabled={pending} onClick={() => run(() => checkJob(i.projectId, note), () => { setNoteFor(null); setNote(""); })}>
                    Save Note
                  </button>
                  <button type="button" className="btn ghost" disabled={pending} onClick={() => { setNoteFor(null); setNote(""); }}>
                    Skip
                  </button>
                </div>
              )}
            </div>
          </li>
        ))}
      </ul>
      {msg.error && <p className="err">{msg.error}</p>}
      <p className="fine">
        Tap a box once you&apos;ve checked in on that job. Posting a daily log for it in JobTread checks it in for you. Only jobs in construction are listed;
        reminders go out at 10 AM and 5 PM for any not checked in yet.
      </p>
    </section>
  );
}
