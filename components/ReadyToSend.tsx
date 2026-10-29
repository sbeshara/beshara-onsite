"use client";

import { useState, useTransition } from "react";
import { reopenReport, sendReports, type Result } from "@/app/studio/actions";

export type ReadyReport = { id: string; project: string; weekStart: string; weekLabel: string; approvedBy: string; approvedAt: string };

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" });

// Approved progress reports waiting to go to clients. The Principal Contractor
// and Admins send them one at a time or all at once.
export default function ReadyToSend({ reports, canSend }: { reports: ReadyReport[]; canSend: boolean }) {
  const [msg, setMsg] = useState<Result>({});
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const run = (key: string, fn: () => Promise<Result>) =>
    start(async () => {
      setBusy(key);
      setMsg({});
      setMsg(await fn());
      setBusy(null);
    });

  if (!reports.length) return msg.ok ? <div className="st-banner ok">{msg.ok}</div> : null;

  return (
    <section className="rts">
      <div className="rts-h">
        <div>
          <h2>Ready to Send · {reports.length}</h2>
          <p>Approved progress reports. Nothing reaches the client until it&apos;s sent.</p>
        </div>
        {canSend && reports.length > 1 && (
          <button type="button" className="btn" disabled={pending} onClick={() => run("all", () => sendReports(reports.map((r) => r.id)))}>
            {busy === "all" ? "Sending…" : `Send All ${reports.length}`}
          </button>
        )}
      </div>
      <ul className="rts-list">
        {reports.map((r) => (
          <li key={r.id}>
            <div className="rts-main">
              <a className="rts-name" href={`/studio?week=${r.weekStart}&r=${r.id}`}>{r.project}</a>
              <span className="rts-sub">
                Week of {r.weekLabel} · approved by {r.approvedBy || "the team"} · {when(r.approvedAt)}
              </span>
            </div>
            <span className="rts-btns">
              <a className="linkbtn" href={`/studio/r/${r.id}/pdf`} target="_blank" rel="noreferrer">Preview PDF</a>
              <button type="button" className="linkbtn" disabled={pending} onClick={() => run(`re-${r.id}`, () => reopenReport(r.id))}>
                {busy === `re-${r.id}` ? "Reopening…" : "Reopen to Edit"}
              </button>
              {canSend && (
                <button type="button" className="btn" disabled={pending} onClick={() => run(r.id, () => sendReports([r.id]))}>
                  {busy === r.id ? "Sending…" : "Send"}
                </button>
              )}
            </span>
          </li>
        ))}
      </ul>
      {msg.error && <p className="err">{msg.error}</p>}
      {msg.ok && <p className="ok">{msg.ok}</p>}
      {!canSend && <p className="fine">Julia or the Principal Contractor sends these to the client.</p>}
    </section>
  );
}
