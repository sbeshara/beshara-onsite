"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ReportLine } from "@/lib/report-pdf";
import type { ReportPhoto, WeeklyReport } from "@/lib/reports";
import { approveReport, generateNow, saveReport, setReportStatus, type Result } from "../../actions";

type Props = { report: WeeklyReport; thumbs: Record<string, string>; canApprove: boolean };

function Lines({ label, lines, setLines, withDate }: { label: string; lines: ReportLine[]; setLines: (l: ReportLine[]) => void; withDate: boolean; }) {
  const update = (i: number, k: keyof ReportLine, v: string) => setLines(lines.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  return (
    <section className="st-panel">
      <h2>{label}</h2>
      {lines.map((l, i) => (
        <div key={i} className={`st-row ${withDate ? "" : "no-date"}`}>
          <input data-k="trade" aria-label="Trade" placeholder="Trade" value={l.trade} onChange={(e) => update(i, "trade", e.target.value)} />
          <textarea aria-label="What was done" rows={2} value={l.text} onChange={(e) => update(i, "text", e.target.value)} />
          {withDate && <input data-k="date" aria-label="Date" placeholder="10/28" value={l.date ?? ""} onChange={(e) => update(i, "date", e.target.value)} />}
          <button type="button" className="st-x" title="Remove line" aria-label="Remove line" onClick={() => setLines(lines.filter((_, j) => j !== i))}>×</button>
        </div>
      ))}
      {!lines.length && <p className="fine">Nothing here yet.</p>}
      <button type="button" className="linkbtn st-add" onClick={() => setLines([...lines, withDate ? { trade: "", text: "", date: "" } : { trade: "", text: "" }])}>+ Add line</button>
    </section>
  );
}

export default function ReportEditor({ report, thumbs, canApprove }: Props) {
  const router = useRouter();
  const editable = report.status === "draft";
  const [completed, setCompleted] = useState<ReportLine[]>(report.completed);
  const [ahead, setAhead] = useState<ReportLine[]>(report.looking_ahead);
  const [photos, setPhotos] = useState<ReportPhoto[]>(report.photos);
  const [notes, setNotes] = useState(report.pm_notes);
  const [msg, setMsg] = useState<Result>({});
  const [confirm, setConfirm] = useState(false);
  const [pending, start] = useTransition();
  const edits = { completed, looking_ahead: ahead, photos, pm_notes: notes };
  const run = (fn: () => Promise<Result>) =>
    start(async () => {
      setMsg({});
      const r = await fn();
      setMsg(r);
      router.refresh();
    });
  const selected = photos.filter((p) => p.selected).length;

  return (
    <>
      {report.error && <div className="st-banner err">The draft ran into a problem: {report.error}</div>}
      {report.status === "approved" && <div className="st-banner ok">This report was approved and posted to the client.</div>}
      {report.status === "skipped" && <div className="st-banner note">Skipped. Nothing was posted for this week.</div>}
      {report.status === "no_logs" && <div className="st-banner note">There were no daily logs in JobTread for this week, so no draft was written.</div>}
      {report.pm_notes && !editable && <div className="st-banner note">PM notes: {report.pm_notes}</div>}

      <fieldset disabled={!editable || pending} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        <div className="st-grid">
          <div style={{ display: "grid", gap: 16, minWidth: 0 }}>
            <Lines label="Completed" lines={completed} setLines={setCompleted} withDate={false} />
            <Lines label="Looking ahead" lines={ahead} setLines={setAhead} withDate />
          </div>
          <div style={{ display: "grid", gap: 16, minWidth: 0 }}>
            <section className="st-panel">
              <h2>Notes for the reviewer</h2>
              <textarea rows={3} aria-label="Notes for the reviewer" placeholder="PMs: add corrections or context for Julia. Never sent to the client." value={notes} onChange={(e) => setNotes(e.target.value)} />
            </section>
            <section className="st-panel">
              <h2>Photos · {selected} selected</h2>
              {photos.length ? (
                <div className="st-photos">
                  {photos.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      className="st-photo"
                      aria-pressed={p.selected}
                      title={p.name}
                      onClick={() => setPhotos(photos.map((x) => (x.id === p.id ? { ...x, selected: !x.selected } : x)))}
                    >
                      {thumbs[p.id] ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={thumbs[p.id]} alt={p.name} loading="lazy" />
                      ) : (
                        <span className="upl">{p.name}</span>
                      )}
                      <span className="tick">{p.selected ? "✓" : ""}</span>
                      <span className="cap">{p.log_date}</span>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="fine">No photos in this week&apos;s daily logs.</p>
              )}
              <p className="fine">Selected photos go in the PDF and are posted with the report.</p>
            </section>
            <section className="st-panel">
              <h2>Daily logs used</h2>
              {report.source_logs.length ? (
                report.source_logs.map((l, i) => (
                  <div key={i} className="st-log">
                    <b>{l.date} · {l.author}{l.trades.length ? ` · ${l.trades.join(", ")}` : ""}</b>
                    <p>{l.notes || "(no notes)"}</p>
                  </div>
                ))
              ) : (
                <p className="fine">None.</p>
              )}
            </section>
          </div>
        </div>
      </fieldset>

      <div className="st-actions">
        {msg.error && <span className="err">{msg.error}</span>}
        {msg.ok && <span className="ok">{msg.ok}</span>}
        <span className="spacer" />
        {editable && (
          <button type="button" className="btn ghost" disabled={pending} onClick={() => run(() => saveReport(report.id, edits))}>
            Save changes
          </button>
        )}
        {canApprove && editable && (
          <button type="button" className="btn ghost" disabled={pending} onClick={() => run(() => setReportStatus(report.id, "skipped"))}>
            Skip this week
          </button>
        )}
        {canApprove && (report.status === "skipped" || report.status === "no_logs") && (
          <button type="button" className="btn ghost" disabled={pending} onClick={() => run(() => setReportStatus(report.id, "draft"))}>
            Write it anyway
          </button>
        )}
        {canApprove && report.status !== "approved" && (
          <button
            type="button"
            className="btn ghost"
            disabled={pending}
            onClick={() => run(() => generateNow({ projectId: report.project_id, weekStart: report.week_start, force: true }))}
          >
            Redraft from daily logs
          </button>
        )}
        {canApprove && editable &&
          (confirm ? (
            <button type="button" className="btn" disabled={pending} onClick={() => { setConfirm(false); run(() => approveReport(report.id, edits)); }}>
              {pending ? "Posting…" : "Yes, post to the client"}
            </button>
          ) : (
            <button type="button" className="btn" disabled={pending} onClick={() => setConfirm(true)}>
              Approve and post
            </button>
          ))}
        {!canApprove && editable && <span className="fine">Julia or the Principal Contractor approves and posts.</span>}
      </div>
    </>
  );
}
