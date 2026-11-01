"use client";

import { useState, useTransition } from "react";
import { setPermission, type Result } from "@/app/actions";

type Perm = { key: "pm_send_reports" | "pm_create_projects" | "clients_start_chats"; role: string; label: string; detail: string; on: boolean };

// The switches the Principal Contractor can flip per role. Admins can see them.
export default function PermissionsPanel({ perms, canEdit }: { perms: Perm[]; canEdit: boolean }) {
  const [state, setState] = useState(Object.fromEntries(perms.map((p) => [p.key, p.on])) as Record<Perm["key"], boolean>);
  const [msg, setMsg] = useState<Result>({});
  const [pending, start] = useTransition();
  const flip = (key: Perm["key"]) => {
    const next = !state[key];
    setState((s) => ({ ...s, [key]: next }));
    start(async () => {
      const r = await setPermission(key, next);
      setMsg(r);
      if (r.error) setState((s) => ({ ...s, [key]: !next }));
    });
  };
  return (
    <div className="box rowlist perm-list">
      {perms.map((p) => (
        <label key={p.key} className={`rowitem perm-row ${canEdit ? "" : "locked"}`}>
          <span className="perm-role">{p.role}</span>
          <span style={{ minWidth: 0 }}>
            <b>{p.label}</b>
            <small>{p.detail}</small>
          </span>
          <span className="switch">
            <input type="checkbox" role="switch" checked={state[p.key]} disabled={!canEdit || pending} onChange={() => flip(p.key)} aria-label={`${p.role}: ${p.label}`} />
            <span aria-hidden="true" />
          </span>
        </label>
      ))}
      {!canEdit && <p className="fine" style={{ padding: "10px 16px" }}>Only the Principal Contractor can change these.</p>}
      {msg.error && <p className="err" style={{ padding: "10px 16px" }}>{msg.error}</p>}
    </div>
  );
}
