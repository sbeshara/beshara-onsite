"use client";

import { useActionState, useState, useTransition } from "react";
import { addClientContact, removeClientContact, resendInvite, setMainContact, setProjectTeam, type Result } from "@/app/actions";
import Avatar from "@/components/Avatar";
import type { Profile } from "@/lib/types";

type Props = { projectId: string; primaryClientId: string | null; staff: Profile[]; assigned: string[]; clients: Profile[] };

export default function PeopleManager({ projectId, primaryClientId, staff, assigned, clients }: Props) {
  const [selected, setSelected] = useState(assigned);
  const [teamMsg, setTeamMsg] = useState<Result>({});
  const [contactMsg, setContactMsg] = useState<Result>({});
  const [pending, start] = useTransition();
  const [addState, addAction, adding] = useActionState<Result, FormData>(addClientContact.bind(null, projectId), {});

  const run = (fn: () => Promise<Result>, set: (r: Result) => void) => start(async () => set(await fn()));

  return (
    <>
      <section>
        <div className="sec-h"><h2>Beshara Team</h2></div>
        <p className="fine" style={{ marginBottom: 10 }}>The Principal Contractor and Admin see every project. Check who on Construction Management works on this job.</p>
        <div className="opts" style={{ maxWidth: 560 }}>
          {staff.map((p) => (
            <label key={p.id} className="opt">
              <input
                type="checkbox"
                checked={selected.includes(p.id)}
                onChange={(e) => setSelected((s) => (e.target.checked ? [...s, p.id] : s.filter((x) => x !== p.id)))}
              />
              <span><b>{p.full_name || p.email}</b><small>Construction Management</small></span>
            </label>
          ))}
          {!staff.length && <p className="fine">No one on Construction Management yet. Invite them from the Team page.</p>}
        </div>
        {staff.length > 0 && (
          <div className="actions" style={{ justifyContent: "flex-start", marginTop: 12 }}>
            <button className="btn" type="button" disabled={pending} onClick={() => run(() => setProjectTeam(projectId, selected), setTeamMsg)}>
              Save Team
            </button>
            {teamMsg.error && <p className="err">{teamMsg.error}</p>}
            {teamMsg.ok && <p className="ok">{teamMsg.ok}</p>}
          </div>
        )}
      </section>

      <section>
        <div className="sec-h"><h2>Client Contacts</h2></div>
        <div className="box rowlist" style={{ maxWidth: 720 }}>
          {clients.map((p) => (
            <div key={p.id} className="rowitem">
              <Avatar id={p.id} name={p.full_name || p.email} />
              <div style={{ minWidth: 0 }}>
                <b>{p.full_name || p.email}</b>
                <small>
                  {[p.title, p.email].filter(Boolean).join(" · ")}
                  {p.id === primaryClientId ? " · Main Contact" : ""}
                </small>
              </div>
              <span className="cbtns">
                <button type="button" className="linkbtn" disabled={pending} onClick={() => run(() => resendInvite(p.id), setContactMsg)}>Resend Invite</button>
                {p.id !== primaryClientId && (
                  <>
                    <button type="button" className="linkbtn" disabled={pending} onClick={() => run(() => setMainContact(projectId, p.id), setContactMsg)}>Make Main Contact</button>
                    <button type="button" className="linkbtn" disabled={pending} onClick={() => run(() => removeClientContact(projectId, p.id), setContactMsg)}>Remove</button>
                  </>
                )}
              </span>
            </div>
          ))}
          {!clients.length && <div className="empty-hint">No client contacts yet.</div>}
        </div>
        {contactMsg.error && <p className="err" style={{ marginTop: 8 }}>{contactMsg.error}</p>}
        {contactMsg.ok && <p className="ok" style={{ marginTop: 8 }}>{contactMsg.ok}</p>}
      </section>

      <section>
        <div className="sec-h"><h2>Add a Client Contact</h2></div>
        <form className="form" action={addAction}>
          <div className="row2">
            <label className="field">Name<input name="name" required autoComplete="off" placeholder="e.g. Lisa M." /></label>
            <label className="field">Role at the Practice<input name="title" autoComplete="off" placeholder="e.g. Office manager" /></label>
          </div>
          <label className="field">Email<input name="email" type="email" required autoComplete="off" placeholder="name@practice.com" /></label>
          {addState.error && <p className="err">{addState.error}</p>}
          {addState.ok && <p className="ok">{addState.ok}</p>}
          <div className="actions" style={{ justifyContent: "flex-start" }}>
            <button className="btn" type="submit" disabled={adding}>{adding ? "Sending…" : "Add and Send Invite"}</button>
          </div>
        </form>
      </section>
    </>
  );
}
