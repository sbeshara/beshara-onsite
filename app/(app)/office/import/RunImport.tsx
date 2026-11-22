"use client";

import { useState, useTransition } from "react";
import { runDocumentImport, runInvoiceImport, runJobTreadImport, type Result } from "../actions";

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

// Imports documents 15 at a time until none are left, showing progress.
export function RunDocuments() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ error?: string; ok?: string }>({});
  async function go() {
    setBusy(true);
    setMsg({});
    let total = 0;
    try {
      for (let i = 0; i < 40; i++) {
        const r = await runDocumentImport();
        if (r.error) { setMsg({ error: r.error }); break; }
        total += r.done ?? 0;
        setMsg({ ok: `Imported ${total} documents${r.remaining ? `, ${r.remaining} to go…` : "."}${!r.remaining && r.skipped?.length ? ` Skipped ${r.skipped.length} whose job isn't in OnSite: ${r.skipped.join(", ")}.` : ""}` });
        if (!r.remaining) break;
      }
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="actions" style={{ justifyContent: "flex-start" }}>
        <button className="btn" disabled={busy} onClick={go}>{busy ? "Importing…" : "Import proposals and templates"}</button>
      </div>
      {msg.error && <p className="err" role="alert">{msg.error}</p>}
      {msg.ok && <p className="ok" role="status">{msg.ok}</p>}
    </>
  );
}

export function RunInvoices() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ error?: string; ok?: string }>({});
  async function go() {
    setBusy(true);
    setMsg({});
    let total = 0, linked = 0;
    try {
      for (let i = 0; i < 20; i++) {
        const r = await runInvoiceImport();
        if (r.error) { setMsg({ error: r.error }); break; }
        total += r.done ?? 0;
        linked += r.linked ?? 0;
        setMsg({ ok: `Imported ${total} invoices (${linked} matched to a payment step)${r.remaining ? `, ${r.remaining} to go…` : "."}${!r.remaining && r.skipped?.length ? ` Skipped ${r.skipped.length}: ${r.skipped.join(", ")}.` : ""}` });
        if (!r.remaining) break;
      }
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="actions" style={{ justifyContent: "flex-start" }}>
        <button className="btn" disabled={busy} onClick={go}>{busy ? "Importing…" : "Import invoices and payments"}</button>
      </div>
      {msg.error && <p className="err" role="alert">{msg.error}</p>}
      {msg.ok && <p className="ok" role="status">{msg.ok}</p>}
    </>
  );
}
