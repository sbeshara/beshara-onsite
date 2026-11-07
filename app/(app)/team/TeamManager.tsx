"use client";

import { useActionState, useState, useTransition } from "react";
import { inviteTeamMember, removeTeamMember, resendInvite, setAssignment, setRole, setSeniorPm, type Result } from "@/app/actions";
import Avatar from "@/components/Avatar";
import { ROLE_LABEL } from "@/lib/constants";
import { plural } from "@/lib/format";
import type { Profile, Role } from "@/lib/types";

type Props = {
  me: { id: string; role: Role };
  people: Profile[];
  projects: { id: string; name: string; town: string }[];
  assigned: Record<string, string[]>;
  lastSignIn: Record<string, string | null>;
  senior: string[]; // Senior PMs: also see HQ's team check-in board
};

const since = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

export default function TeamManager({ me, people, projects, assigned: initial, lastSignIn, senior: initialSenior }: Props) {
  const [senior, setSenior] = useState(initialSenior);
  // Ticks update right away; the server saves each one.
  const [assigned, setAssigned] = useState(initial);
  const toggle = (userId: string, projectId: string, on: boolean) => {
    setAssigned((a) => ({ ...a, [userId]: on ? [...(a[userId] ?? []), projectId] : (a[userId] ?? []).filter((x) => x !== projectId) }));
    start(async () => {
      const r = await setAssignment(userId, projectId, on);
      setMsg(r);
      if (r.error) setAssigned((a) => ({ ...a, [userId]: on ? (a[userId] ?? []).filter((x) => x !== projectId) : [...(a[userId] ?? []), projectId] }));
    });
  };
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
              <div key={p.id} className="rowitem team-row">
                <Avatar id={p.id} name={p.full_name || p.email} url={p.avatar_url} />
                <div style={{ minWidth: 0 }}>
                  <b>{p.full_name || p.email}</b>
                  <small>
                    {p.email}
                    {p.role === "construction" ? ` · ${senior.includes(p.id) ? "Senior PM · " : ""}${plural(assigned[p.id]?.length ?? 0, "job")}` : " · sees every job"}
                  </small>
                  <small className={`signin ${lastSignIn[p.id] ? "in" : ""}`}>
                    {lastSignIn[p.id] ? `Signed in · last on ${since(lastSignIn[p.id]!)}` : "Invite pending · hasn't signed in yet"}
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
                    <a className="linkbtn" href={`/view-as?user=${p.id}`} title={`See OnSite and HQ the way ${p.full_name || p.email} does (read-only)`}>
                      View As
                    </a>
                  )}
                  {p.id !== me.id && (
                    <button type="button" className="linkbtn" disabled={pending} onClick={() => run(() => resendInvite(p.id))}>
                      {lastSignIn[p.id] ? "Send Password Link" : "Resend Invite"}
                    </button>
                  )}
                  {removable &&
                    (confirming === p.id ? (
                      <button type="button" className="linkbtn" style={{ color: "#B3261E" }} disabled={pending} onClick={() => { setConfirming(null); run(() => removeTeamMember(p.id)); }}>
                        Confirm Remove
                      </button>
                    ) : (
                      <button type="button" className="linkbtn" onClick={() => setConfirming(p.id)}>Remove</button>
                    ))}
                </span>
                {p.role === "construction" && (
                  <label className="senior-pick">
                    <input
                      type="checkbox"
                      checked={senior.includes(p.id)}
                      disabled={pending}
                      onChange={(e) => {
                        const on = e.target.checked;
                        setSenior((s) => (on ? [...s, p.id] : s.filter((x) => x !== p.id)));
                        start(async () => {
                          const r = await setSeniorPm(p.id, on);
                          setMsg(r);
                          if (r.error) setSenior((s) => (on ? s.filter((x) => x !== p.id) : [...s, p.id]));
                        });
                      }}
                    />
                    <span>
                      <b>Senior PM</b> · also sees the team check-in board on HQ (every PM&apos;s daily logs). Their own jobs and logs stay the same.
                    </span>
                  </label>
                )}
                {p.role === "construction" && (
                  <fieldset className="jobpick">
                    <legend>Jobs {p.full_name.split(" ")[0] || "they"} Can See</legend>
                    {projects.map((j) => {
                      const on = assigned[p.id]?.includes(j.id) ?? false;
                      return (
                        <label key={j.id} className={on ? "on" : ""}>
                          <input type="checkbox" checked={on} onChange={(e) => toggle(p.id, j.id, e.target.checked)} />
                          <span>{j.name}</span>
                        </label>
                      );
                    })}
                    {!projects.length && <span className="upl">No jobs yet.</span>}
                  </fieldset>
                )}
              </div>
            );
          })}
        </div>
        {msg.error && <p className="err" style={{ marginTop: 8 }}>{msg.error}</p>}
        {msg.ok && <p className="ok" style={{ marginTop: 8 }}>{msg.ok}</p>}
      </section>
      <section>
        <div className="sec-h"><h2>Invite Someone to the Team</h2></div>
        <form className="form" action={action}>
          <div className="row2">
            <label className="field">Name<input name="name" required autoComplete="off" placeholder="e.g. Marco Rossi" /></label>
            <label className="field">Email<input name="email" type="email" required autoComplete="off" placeholder="name@besharabuilders.com" /></label>
          </div>
          <label className="field">
            Role
            <select name="role" defaultValue="construction">
              <option value="construction">Construction Management (Sees Assigned Jobs)</option>
              {owner && <option value="admin">Admin (Sees Everything, Manages Projects and People)</option>}
            </select>
          </label>
          {state.error && <p className="err">{state.error}</p>}
          {state.ok && <p className="ok">{state.ok}</p>}
          <div className="actions" style={{ justifyContent: "flex-start" }}>
            <button className="btn" type="submit" disabled={inviting}>{inviting ? "Sending…" : "Send Invite"}</button>
          </div>
        </form>
      </section>
    </>
  );
}
