"use client";

import { useActionState, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { checkPaymentsNow, createInvoice, disconnectQuickBooks, sendInvoice, setStepReached, voidInvoice, type Result } from "./actions";

export function StepReached({ stepId, projectId, reached }: { stepId: string; projectId: string; reached: boolean }) {
  const [pending, start] = useTransition();
  const [r, setR] = useState<Result>({});
  return (
    <>
      <button className={reached ? "textbtn" : "linkbtn"} disabled={pending} onClick={() => start(async () => setR(await setStepReached(stepId, projectId, !reached)))}>
        {reached ? "Undo" : "Mark reached"}
      </button>
      {r.error && <small className="err">{r.error}</small>}
    </>
  );
}

export function InvoiceButton(props: { projectId: string; estimateId?: string; stepId?: string; amount: number; description: string; email: string; label?: string; canSend: boolean }) {
  const [open, setOpen] = useState(false);
  if (!props.canSend) return null;
  return (
    <>
      <button className="btn" onClick={() => setOpen(true)} style={{ padding: "6px 12px", fontSize: 13 }}>{props.label ?? "Create invoice"}</button>
      {open && <InvoiceDialog {...props} onClose={() => setOpen(false)} />}
    </>
  );
}

function InvoiceDialog({ projectId, estimateId, stepId, amount, description, email, onClose }: { projectId: string; estimateId?: string; stepId?: string; amount: number; description: string; email: string; onClose: () => void }) {
  const router = useRouter();
  const [state, action, pending] = useActionState<Result, FormData>(async (p, f) => {
    const r = await createInvoice(p, f);
    if (r.ok) router.refresh();
    return r;
  }, {});
  const due = new Date(Date.now() + 15 * 864e5).toISOString().slice(0, 10);
  return (
    <div className="modal-bg" role="presentation" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="New invoice" style={{ maxWidth: 520 }}>
        <h2 style={{ fontFamily: "var(--f-display)", fontWeight: 500 }}>New invoice</h2>
        {state.ok ? (
          <>
            <p className="ok">{state.ok}</p>
            <div className="actions"><button className="btn" onClick={onClose}>Done</button></div>
          </>
        ) : (
          <form className="form" action={action} style={{ maxWidth: "none" }}>
            <input type="hidden" name="project_id" value={projectId} />
            {estimateId && <input type="hidden" name="estimate_id" value={estimateId} />}
            {stepId && <input type="hidden" name="step_id" value={stepId} />}
            <label className="field">For<input name="description" defaultValue={description} /></label>
            <div className="row2">
              <label className="field">Amount<input name="amount" inputMode="decimal" defaultValue={amount.toFixed(2)} /></label>
              <label className="field">Due<input name="due_on" type="date" defaultValue={due} /></label>
            </div>
            <label className="field">Email it to<input name="email_to" type="email" defaultValue={email} required /></label>
            <label className="field">Note on the invoice<textarea name="memo" rows={2} placeholder="Optional, e.g. thank you for your business" /></label>
            <p className="fine">Send creates the invoice in QuickBooks Online and QuickBooks emails it, with its pay-online link if you take payments there. Payments recorded in QuickBooks show up here.</p>
            {state.error && <p className="err" role="alert">{state.error}</p>}
            <div className="actions">
              <button className="btn ghost" type="button" onClick={onClose}>Cancel</button>
              <button className="btn ghost" type="submit" name="send" value="0" disabled={pending}>Save draft</button>
              <button className="btn" type="submit" name="send" value="1" disabled={pending}>{pending ? "Working…" : "Send through QuickBooks"}</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

export function InvoiceRowActions({ id, status, inQbo, canSend }: { id: string; status: string; inQbo: boolean; canSend: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [r, setR] = useState<Result>({});
  if (!canSend) return null;
  const run = (fn: () => Promise<Result>) => start(async () => { const x = await fn(); setR(x); if (x.ok) router.refresh(); });
  return (
    <span style={{ display: "inline-flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      {status === "draft" && <button className="linkbtn" disabled={pending} onClick={() => run(() => sendInvoice(id))}>{pending ? "Sending…" : "Send"}</button>}
      {status === "draft" && !inQbo && <button className="textbtn" disabled={pending} onClick={() => run(() => voidInvoice(id))}>Void</button>}
      {(status === "sent" || status === "partial") && <button className="textbtn" disabled={pending} onClick={() => run(() => sendInvoice(id))}>Resend</button>}
      {r.error && <small className="err">{r.error}</small>}
    </span>
  );
}

export function QboControls({ connected, canManage }: { connected: boolean; canManage: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [r, setR] = useState<Result>({});
  return (
    <span style={{ display: "inline-flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      {connected && <button className="btn ghost" disabled={pending} onClick={() => start(async () => { const x = await checkPaymentsNow(); setR(x); router.refresh(); })}>{pending ? "Checking…" : "Check payments now"}</button>}
      {canManage && !connected && <a className="btn" href="/api/qbo/connect">Connect QuickBooks Online</a>}
      {canManage && connected && <button className="textbtn" disabled={pending} onClick={() => start(async () => { const x = await disconnectQuickBooks(); setR(x); router.refresh(); })}>Disconnect</button>}
      {r.error && <small className="err">{r.error}</small>}
      {r.ok && <small className="ok">{r.ok}</small>}
    </span>
  );
}
