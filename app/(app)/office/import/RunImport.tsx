"use client";

import { useState, useTransition } from "react";
import { runJobTreadImport, type Result } from "../actions";

export default function RunImport() {
  const [pending, start] = useTransition();
  const [r, setR] = useState<Result>({});
  return (
    <section className="ocard">
      <h2>Run the import</h2>
      <p className="fine">Takes about a minute. Clients aren&apos;t invited or emailed; imported jobs stay internal until you invite someone.</p>
      <div className="actions" style={{ justifyContent: "flex-start" }}>
        <button className="btn" disabled={pending} onClick={() => start(async () => setR(await runJobTreadImport()))}>
          {pending ? "Importing…" : "Import from JobTread"}
        </button>
      </div>
      {r.error && <p className="err" role="alert">{r.error}</p>}
      {r.ok && <p className="ok" role="status">{r.ok}</p>}
    </section>
  );
}
