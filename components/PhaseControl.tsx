"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ALL_STATUSES, LEAD_STATUSES, JOB_STATUSES, PHASES, PM_STATUSES, STAGES, stageNumber } from "@/lib/constants";
import { createClient } from "@/lib/supabase/client";

// The project's stage bar. Clients see it read-only. The office (Owner, Admin,
// Senior PM, Preconstruction Manager) sets the job status, which moves the
// stage. PMs can switch a job between Permitting and Construction.
export default function PhaseControl({
  projectId,
  phase,
  status,
  mode,
}: {
  projectId: string;
  phase: number;
  status: string;
  mode: "client" | "pm" | "office";
}) {
  const router = useRouter();
  const [current, setCurrent] = useState({ phase, status });
  const [error, setError] = useState("");

  async function setStatus(next: string) {
    if (next === current.status) return;
    const before = current;
    const nextPhase = next === "Permitting" ? 1 : next === "Construction" ? 2 : next === "Complete" ? 4 : 0;
    setCurrent({ status: next, phase: nextPhase });
    setError("");
    const { error } = await createClient().from("projects").update({ status: next }).eq("id", projectId);
    if (error) {
      setCurrent(before);
      setError("Couldn't update the status. Try again.");
      return;
    }
    router.refresh();
  }

  const stage = stageNumber(current.phase) - 1;
  return (
    <div style={{ display: "grid", gap: 8 }}>
      <div className="pb-label">
        {mode === "office" ? (
          <label style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            Job Status
            <select value={current.status} onChange={(e) => setStatus(e.target.value)} aria-label="Job status">
              <optgroup label="Leads">{LEAD_STATUSES.map((s) => <option key={s}>{s}</option>)}</optgroup>
              <optgroup label="Jobs">{JOB_STATUSES.map((s) => <option key={s}>{s}</option>)}</optgroup>
              {!(ALL_STATUSES as readonly string[]).includes(current.status) && <option>{current.status}</option>}
            </select>
          </label>
        ) : (
          "Project Phase"
        )}
        {mode === "office" && <span>The client sees the stage below on their home screen.</span>}
        {mode === "pm" && <span>Tap Permits or Construction to switch. The client sees this on their home screen.</span>}
      </div>
      <div className="phasebar">
        {STAGES.map((ph, i) => {
          const cls = `pstep ${i < stage ? "done" : i === stage ? "now" : ""}`;
          const target = ph === 1 ? "Permitting" : ph === 2 ? "Construction" : null;
          return mode === "pm" && target && (PM_STATUSES as readonly string[]).includes(target) ? (
            <button key={ph} type="button" className={cls} title={`Set to ${target}`} onClick={() => setStatus(target)}>
              <i />
              <span>{PHASES[ph]}</span>
            </button>
          ) : (
            <div key={ph} className={cls}>
              <i />
              <span>{PHASES[ph]}</span>
            </div>
          );
        })}
      </div>
      {error && <p className="err">{error}</p>}
    </div>
  );
}
