"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { declineProposal, signProposal } from "./actions";

// Type your name, draw your signature, agree, sign.
export default function SignBox({ projectId, estimateId, kind, total, defaultName }: { projectId: string; estimateId: string; kind: string; total: number; defaultName: string }) {
  const router = useRouter();
  const pad = useRef<HTMLCanvasElement>(null);
  const [name, setName] = useState(defaultName);
  const [agree, setAgree] = useState(false);
  const [drawn, setDrawn] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState<{ error?: string; ok?: string }>({});
  const [pending, start] = useTransition();

  useEffect(() => {
    const c = pad.current!;
    const r = c.getBoundingClientRect(), d = window.devicePixelRatio || 1;
    c.width = r.width * d;
    c.height = r.height * d;
    const ctx = c.getContext("2d")!;
    ctx.scale(d, d);
    ctx.lineWidth = 2.4;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#151B18";
    let down = false;
    const pos = (e: PointerEvent) => { const b = c.getBoundingClientRect(); return [e.clientX - b.left, e.clientY - b.top] as const; };
    const onDown = (e: PointerEvent) => { down = true; c.setPointerCapture(e.pointerId); ctx.beginPath(); ctx.moveTo(...pos(e)); };
    const onMove = (e: PointerEvent) => { if (!down) return; ctx.lineTo(...pos(e)); ctx.stroke(); setDrawn(true); };
    const onUp = () => { down = false; };
    c.addEventListener("pointerdown", onDown);
    c.addEventListener("pointermove", onMove);
    c.addEventListener("pointerup", onUp);
    return () => { c.removeEventListener("pointerdown", onDown); c.removeEventListener("pointermove", onMove); c.removeEventListener("pointerup", onUp); };
  }, []);

  function clear() {
    const c = pad.current!;
    c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
    setDrawn(false);
  }
  function sign() {
    if (name.trim().length < 2 || !drawn || !agree) return setMsg({ error: "Type your full name, sign in the box, and check the box to agree." });
    // Signature on white so it reads anywhere.
    const c = pad.current!, out = document.createElement("canvas");
    out.width = c.width;
    out.height = c.height;
    const g = out.getContext("2d")!;
    g.fillStyle = "#fff";
    g.fillRect(0, 0, out.width, out.height);
    g.drawImage(c, 0, 0);
    const data = out.toDataURL("image/png");
    start(async () => {
      const r = await signProposal(projectId, estimateId, name, data);
      setMsg(r);
      if (r.ok) router.refresh();
    });
  }
  const usd = total.toLocaleString("en-US", { style: "currency", currency: "USD" });
  return (
    <div className="signbox">
      <b>Approve and sign</b>
      <label className="field">
        Your full name
        <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
      </label>
      <div className="field">
        <span>Signature</span>
        <canvas ref={pad} className="sigpad" aria-label="Sign here with your finger, mouse or pen" />
        <button type="button" className="textbtn" onClick={clear} style={{ justifySelf: "start" }}>Clear</button>
      </div>
      <label className="agree">
        <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
        <span>I approve this {kind.toLowerCase()} for {usd} and agree to its payment schedule and terms. I understand this is my electronic signature.</span>
      </label>
      {msg.error && <p className="err" role="alert">{msg.error}</p>}
      {msg.ok && <p className="ok" role="status">{msg.ok}</p>}
      {declining ? (
        <div className="field">
          <span>Why are you declining? (optional)</span>
          <textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
          <div className="actions" style={{ justifyContent: "flex-start" }}>
            <button className="btn ghost" disabled={pending} onClick={() => start(async () => { const r = await declineProposal(projectId, estimateId, reason); setMsg(r); if (r.ok) router.refresh(); })}>Decline</button>
            <button className="textbtn" onClick={() => setDeclining(false)}>Cancel</button>
          </div>
        </div>
      ) : (
        <div className="actions" style={{ justifyContent: "flex-start" }}>
          <button className="btn" disabled={pending} onClick={sign}>{pending ? "Signing…" : "Approve & sign"}</button>
          <button className="textbtn" onClick={() => setDeclining(true)}>Decline</button>
        </div>
      )}
    </div>
  );
}
