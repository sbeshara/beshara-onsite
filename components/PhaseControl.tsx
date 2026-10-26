"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PHASES } from "@/lib/constants";
import { createClient } from "@/lib/supabase/client";

// The team taps a step to move the project along; clients see it read-only.
export default function PhaseControl({ projectId, phase, canEdit }: { projectId: string; phase: number; canEdit: boolean }) {
  const router = useRouter();
  const [current, setCurrent] = useState(phase);
  const [error, setError] = useState("");

  async function set(i: number) {
    if (i === current) return;
    const before = current;
    setCurrent(i);
    setError("");
    const { error } = await createClient().from("projects").update({ phase: i }).eq("id", projectId);
    if (error) {
      setCurrent(before);
      setError("Couldn't update the phase. Try again.");
      return;
    }
    router.refresh();
  }

  return (
    <div style={{ display: "grid", gap: 8 }}>
      <div className="pb-label">
        Project phase
        {canEdit && <span>Tap a step to update it. The client sees this on their home screen.</span>}
      </div>
      <div className="phasebar">
        {PHASES.map((ph, i) => {
          const cls = `pstep ${i < current ? "done" : i === current ? "now" : ""}`;
          return canEdit ? (
            <button key={ph} type="button" className={cls} title={`Set phase to ${ph}`} onClick={() => set(i)}>
              <i />
              <span>{ph}</span>
            </button>
          ) : (
            <div key={ph} className={cls}>
              <i />
              <span>{ph}</span>
            </div>
          );
        })}
      </div>
      {error && <p className="err">{error}</p>}
    </div>
  );
}
