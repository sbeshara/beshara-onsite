"use client";

import { useState, useTransition } from "react";
import { generateNow, type Result } from "./actions";

export default function GenerateButton({ weekStart }: { weekStart: string }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<Result>({});
  return (
    <div style={{ display: "grid", gap: 6, justifyItems: "end" }}>
      <button className="btn" type="button" disabled={pending} onClick={() => start(async () => setMsg(await generateNow({ weekStart })))}>
        {pending ? "Drafting… (about a minute)" : "Draft missing reports now"}
      </button>
      {msg.error && <p className="err" style={{ maxWidth: 420, textAlign: "right" }}>{msg.error}</p>}
      {msg.ok && <p className="ok">{msg.ok}</p>}
    </div>
  );
}
