"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReportLine } from "@/lib/report-pdf";
import type { ReportPhoto, WeeklyReport } from "@/lib/reports";
import { approveReport, generateNow, saveReport, setReportStatus, type Result } from "./actions";

type Props = {
  report: WeeklyReport;
  project: { name: string; town: string; job: string | null };
  thumbs: Record<string, string>;
  editedBy: string;
  approvedBy: string;
  draftName: string;
  nextHref: string;
  listHref: string;
};

const short = (iso: string) => {
  const [y, m, d] = iso.split("-");
  return `${Number(m)}/${Number(d)}/${y.slice(2)}`;
};
const nextMonday = (iso: string) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 7);
  return d.toISOString().slice(0, 10);
};
// Friday, Saturday or Sunday: the logs Looking Ahead can come from.
const isLookAheadDay = (iso: string) => [5, 6, 0].includes(new Date(`${iso}T12:00:00Z`).getUTCDay());

function Lines({ label, hint, lines, setLines }: { label: string; hint: string; lines: ReportLine[]; setLines: (l: ReportLine[]) => void }) {
  const update = (i: number, k: keyof ReportLine, v: string) => setLines(lines.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  return (
    <section className="st-panel">
      <h2>{label}</h2>
      <p className="fine" style={{ marginTop: 0 }}>{hint}</p>
      {lines.map((l, i) => (
        <div key={i} className="st-row no-date">
          <input data-k="trade" aria-label="Trade" placeholder="Trade" value={l.trade} onChange={(e) => update(i, "trade", e.target.value)} />
          <textarea aria-label="Summary" rows={2} value={l.text} onChange={(e) => update(i, "text", e.target.value)} />
          <button type="button" className="st-x" title="Remove line" aria-label="Remove line" onClick={() => setLines(lines.filter((_, j) => j !== i))}>×</button>
        </div>
      ))}
      {!lines.length && <p className="fine">Nothing here yet.</p>}
      <button type="button" className="linkbtn st-add" onClick={() => setLines([...lines, { trade: "", text: "" }])}>+ Add line</button>
    </section>
  );
}

export default function ReportEditor({ report, project, thumbs, editedBy, approvedBy, draftName, nextHref, listHref }: Props) {
  const router = useRouter();
  const editable = report.status === "draft";
  const [completed, setCompleted] = useState<ReportLine[]>(report.completed);
  const [ahead, setAhead] = useState<ReportLine[]>(report.looking_ahead);
  const [layout, setLayout] = useState<WeeklyReport["layout"]>(report.layout ?? "standard");
  const [skipCompleted, setSkipCompleted] = useState(!!report.skip_completed);
  const [photos, setPhotos] = useState<ReportPhoto[]>(report.photos);
  const [notes, setNotes] = useState(report.pm_notes);
  const [msg, setMsg] = useState<Result>({});
  const [preview, setPreview] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const edits = { completed, looking_ahead: ahead, layout, skip_completed: skipCompleted, photos, pm_notes: notes };
  const run = (fn: () => Promise<Result>, then?: string) =>
    start(async () => {
      setMsg({});
      const r = await fn();
      if (r.ok && then) router.push(then);
      else {
        setMsg(r);
        router.refresh();
      }
    });
  // Saves first so the preview shows exactly what's on screen.
  const openPreview = () =>
    start(async () => {
      setMsg({});
      if (editable) {
        const r = await saveReport(report.id, edits);
        if (r.error) return setMsg(r);
      }
      setPreview(`/studio/r/${report.id}/pdf?v=${Date.now()}`);
    });
  const canPost = ahead.some((l) => l.text.trim()) && (completed.some((l) => l.text.trim()) || skipCompleted);
  const selected = photos.filter((p) => p.selected).length;
  const usesPhotos = layout === "standard" && !skipCompleted;
  const togglePhoto = (id: string) => {
    const p = photos.find((x) => x.id === id);
    if (!p) return;
    if (!p.selected && selected >= 2) {
      setMsg({ error: "The report has two photo spots. Unselect one first." });
      return;
    }
    setMsg({});
    setPhotos(photos.map((x) => (x.id === id ? { ...x, selected: !x.selected } : x)));
  };

  return (
    <>
      <div className="st-h">
        <div style={{ minWidth: 0 }}>
          <p className="st-back"><Link href={listHref} className="textbtn">← All jobs</Link></p>
          <h1>{project.name}</h1>
          <p>
            Week of {short(report.week_start)}
            {project.job ? ` · JobTread ${project.job}` : ""}
            {project.town ? ` · ${project.town}` : ""}
            {editedBy ? ` · last edited by ${editedBy}` : ""}
            {report.approved_at ? ` · posted by ${approvedBy} on ${new Date(report.approved_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : ""}
          </p>
        </div>
        <button type="button" className="btn ghost" disabled={pending} onClick={openPreview}>Preview PDF</button>
      </div>
      {report.error && <div className="st-banner err">The draft ran into a problem: {report.error}</div>}
      {report.status === "approved" && <div className="st-banner ok">This report was approved and posted to the client.</div>}
      {report.status === "skipped" && <div className="st-banner note">Skipped. Nothing was posted for this week.</div>}
      {report.status === "no_logs" && <div className="st-banner note">There were no daily logs in JobTread for this week, so no draft was written.</div>}
      {editable && !report.looking_ahead.length && (
        <div className="st-banner err">
          Looking Ahead is pending:{" "}
          {report.source_logs.some((l) => isLookAheadDay(l.date))
            ? "none of the Friday, Saturday or Sunday logs has a work-to-be-conducted section"
            : "there's no Friday, Saturday or Sunday daily log"}
          . The project&apos;s PM was emailed. Add next week&apos;s work below to approve; until then the PDF is named &ldquo;{draftName}&rdquo;.
        </div>
      )}
      {report.pm_notes && !editable && <div className="st-banner note">Team notes: {report.pm_notes}</div>}

      <fieldset disabled={!editable || pending} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        <div className="st-grid">
          <div style={{ display: "grid", gap: 16, minWidth: 0 }}>
            <Lines label="Completed" hint="1 to 4 high-level lines for the week. No dates, minor items or one-off events." lines={completed} setLines={setCompleted} />
            <Lines label="Looking ahead" hint={`Week of ${short(nextMonday(report.week_start))}. From the work-to-be-conducted section of the Friday, Saturday or Sunday log.`} lines={ahead} setLines={setAhead} />
          </div>
          <div style={{ display: "grid", gap: 16, minWidth: 0 }}>
            <section className="st-panel">
              <h2>PDF layout</h2>
              <label className="st-opt">
                <input type="radio" name="layout" checked={layout === "standard"} onChange={() => setLayout("standard")} />
                <span><b>Standard</b> · cover, Completed with two site photos, Looking Ahead</span>
              </label>
              <label className="st-opt">
                <input type="radio" name="layout" checked={layout === "combined"} onChange={() => setLayout("combined")} />
                <span><b>One page</b> · cover, then Completed and Looking Ahead together, no photos</span>
              </label>
              {layout === "standard" && (
                <label className="st-opt">
                  <input type="checkbox" checked={skipCompleted} onChange={(e) => setSkipCompleted(e.target.checked)} />
                  <span>Leave out the Completed page (cover and Looking Ahead only)</span>
                </label>
              )}
            </section>
            <section className="st-panel">
              <h2>Team notes</h2>
              <textarea rows={3} aria-label="Team notes" placeholder="Corrections or context for whoever approves. Never sent to the client." value={notes} onChange={(e) => setNotes(e.target.value)} />
            </section>
            <section className="st-panel">
              <h2>Photos · {selected} of 2 selected</h2>
              {photos.length ? (
                <div className="st-photos">
                  {photos.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      className="st-photo"
                      aria-pressed={p.selected}
                      title={p.name}
                      onClick={() => togglePhoto(p.id)}
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
              <p className="fine">
                {usesPhotos
                  ? "The two selected photos go on the Completed page and are posted with the report. With none selected, the PDF shows gray placeholders."
                  : "This layout has no photo spots, so no photos are included."}
              </p>
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
        {editable && (
          <button type="button" className="btn ghost" disabled={pending} onClick={() => run(() => setReportStatus(report.id, "skipped"), nextHref)}>
            Skip this week
          </button>
        )}
        {(report.status === "skipped" || report.status === "no_logs") && (
          <button type="button" className="btn ghost" disabled={pending} onClick={() => run(() => setReportStatus(report.id, "draft"))}>
            Write it anyway
          </button>
        )}
        {report.status !== "approved" && (
          <button
            type="button"
            className="btn ghost"
            disabled={pending}
            onClick={() => run(() => generateNow({ projectId: report.project_id, weekStart: report.week_start, force: true }))}
          >
            Redraft from daily logs
          </button>
        )}
        {editable && (
          <button
            type="button"
            className="btn"
            disabled={pending || !canPost}
            title={canPost ? "Posts the PDF and photos to the client's Weekly Progress Report chat" : "Add Looking Ahead first"}
            onClick={() => run(() => approveReport(report.id, edits), `${nextHref}&posted=${encodeURIComponent(project.name)}`)}
          >
            {pending ? "Working…" : "Approve and post"}
          </button>
        )}
      </div>

      {preview && (
        <div className="st-modal" role="dialog" aria-label="PDF preview" onClick={() => setPreview(null)}>
          <div className="st-modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="st-modal-h">
              <b>Preview · what the client receives</b>
              <a className="textbtn" href={preview} target="_blank" rel="noreferrer">Open in new tab</a>
              <button type="button" className="st-x" aria-label="Close preview" onClick={() => setPreview(null)}>×</button>
            </div>
            <iframe src={preview} title="Report PDF" />
          </div>
        </div>
      )}
    </>
  );
}
