"use client";

import { useState, useTransition } from "react";
import { linkJob, type Result } from "../actions";

export type LinkIssue = { projectId: string; project: string; problem: string; suggestions: { id: string; label: string; display: string }[] };

// Projects whose JobTread link looks wrong, with a one-click fix when the
// customer has a job that's in Construction, Preconstruction or Approved.
export default function LinkCheck({ issues }: { issues: LinkIssue[] }) {
  const [msg, setMsg] = useState<Record<string, Result>>({});
  const [pending, start] = useTransition();
  if (!issues.length) return <div className="st-banner ok">Link Check: every linked project points at a job in Construction, Preconstruction or Approved.</div>;
  return (
    <section className="st-panel">
      <h2>Link Check · {issues.length} to Fix</h2>
      <div style={{ display: "grid", gap: 10 }}>
        {issues.map((i) => (
          <div key={i.projectId} className="imp-row">
            <span>
              <b>{i.project}</b> · {i.problem}
            </span>
            <span className="imp-match">
              {i.suggestions.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className="linkbtn"
                  disabled={pending}
                  onClick={() =>
                    start(async () => {
                      const r = await linkJob(i.projectId, s.id, s.label);
                      setMsg((m) => ({ ...m, [i.projectId]: r }));
                    })
                  }
                >
                  Switch to {s.display}
                </button>
              ))}
              {!i.suggestions.length && <span className="fine">Pick the right job in the list below.</span>}
              {msg[i.projectId]?.error && <span className="err">{msg[i.projectId].error}</span>}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
