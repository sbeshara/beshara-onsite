"use client";

import { useActionState, useState, useTransition } from "react";
import { inviteTeamMember, removeTeamMember, resendInvite, setRole, type Result } from "@/app/actions";
import Avatar from "@/components/Avatar";
import { ROLE_LABEL } from "@/lib/constants";
import { plural } from "@/lib/format";
import type { Profile, Role } from "@/lib/types";

type Props = { me: { id: string; role: Role }; people: Profile[]; counts: Record<string, number> };

export default function TeamManager({ me, people, counts }: Props) {
  const [msg, setMsg] = useState<Result>({});
  const [confirming, setConfirming] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [state, action, inviting] = useActionState<Result, FormData>(inviteTeamMember, {});
  const run = (fn: () => Promise<Result>) => start(async () => setMsg(await fn()));
  const owner = me.role === "owner";

  return (
    <>
      <section>
        <div className="box rowlist" style={{ maxWidth: 820 }}>
          {people.map((p) => {
            const editable = owner && p.id !== me.id && p.role !== "owner";
            const removable = p.id !== me.id && p.role !== "owner" && (p.role !== "admin" || owner);
            return (
              <div key={p.id} className="rowitem">
                <Avatar id={p.id} name={p.full_name || p.email} />
                <div style={{ minWidth: 0 }}>
                  <b>{p.full_name || p.email}</b>
                  <small>
                    {p.email}
                    {p.role === "construction" ? ` · ${plural(counts[p.id] ?? 0, "project")}` : ""}
                  </small>
                </div>
                <span className="cbtns">
                  {editable ? (
                    <select
                      aria-label={`Role for ${p.full_name}`}
                      value={p.role}
                      disabled={pending}
                      onChange={(e) => run(() => setRole(p.id, e.target.value as Role))}
                      className="pill"
                    >
                      <option value="admin">Admin</option>
                      <option value="construction">Construction Management</option>
                    </select>
                  ) : (
                    <span className="pill">{ROLE_LABEL[p.role]}</span>
                  )}
                  {p.id !== me.id && (
                    <button type="button" className="linkbtn" disabled={pending} onClick={() => run(() => resendInvite(p.id))}>Resend invite</button>
                  )}
                  {removable &&
                    (confirming === p.id ? (
                      <button type="button" className="linkbtn" style={{ color: "#B3261E" }} disabled={pending} onClick={() => { setConfirming(null); run(() => removeTeamMember(p.id)); }}>
                        Confirm remove
                      </button>
                    ) : (
                      <button type="button" className="linkbtn" onClick={() => setConfirming(p.id)}>Remove</button>
                    ))}
                </span>
              </div>
            );
          })}
        </div>
        {msg.error && <p className="err" style={{ marginTop: 8 }}>{msg.error}</p>}
        {msg.ok && <p className="ok" style={{ marginTop: 8 }}>{msg.ok}</p>}
      </section>
      <section>
        <div className="sec-h"><h2>Invite someone to the team</h2></div>
        <form className="form" action={action}>
          <div className="row2">
            <label className="field">Name<input name="name" required autoComplete="off" placeholder="e.g. Marco Rossi" /></label>
            <label className="field">Email<input name="email" type="email" required autoComplete="off" placeholder="name@besharabuilders.com" /></label>
          </div>
          <label className="field">
            Role
            <select name="role" defaultValue="construction">
              <option value="construction">Construction Management (sees assigned jobs)</option>
              {owner && <option value="admin">Admin (sees everything, manages projects and people)</option>}
            </select>
          </label>
          {state.error && <p className="err">{state.error}</p>}
          {state.ok && <p className="ok">{state.ok}</p>}
          <div className="actions" style={{ justifyContent: "flex-start" }}>
            <button className="btn" type="submit" disabled={inviting}>{inviting ? "Sending…" : "Send invite"}</button>
          </div>
        </form>
      </section>
    </>
  );
}
