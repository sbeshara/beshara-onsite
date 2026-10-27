"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { addClientContact, type Result } from "@/app/actions";

// Invite a client contact without leaving the project.
// With reminder set, it shows the "no client yet" banner instead of a plain
// button; the banner hides once a client exists, but stays open while in use.
type Props = { projectId: string; projectName: string; reminder?: boolean; hasClient?: boolean };

export default function InviteClientButton({ projectId, projectName, reminder, hasClient }: Props) {
  const [open, setOpen] = useState(false);
  const [state, action, sending] = useActionState<Result, FormData>(addClientContact.bind(null, projectId), {});
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) form.current?.reset();
  }, [state]);

  if (reminder && hasClient && !open) return null;
  const button = (
    <button type="button" className={reminder ? "btn" : "linkbtn"} onClick={() => setOpen(true)}>
      Invite Client
    </button>
  );

  return (
    <>
      {reminder ? (
        !hasClient && (
        <div className="noclient">
          <span>
            <b>No client on this project yet.</b> Invite them so they can follow along and message the team.
          </span>
          {button}
        </div>
        )
      ) : (
        button
      )}
      {open && (
        <div className="modal-bg" onClick={(e) => e.target === e.currentTarget && setOpen(false)}>
          <form
            ref={form}
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="invite-h"
            action={action}
            onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
          >
            <h2 id="invite-h">Invite Client</h2>
            <p className="sub">
              They&apos;ll get an email to set a password and join <b>{projectName}</b> on Beshara OnSite.
            </p>
            <div className="row2">
              <label className="field">
                Name
                <input name="name" required autoFocus autoComplete="off" placeholder="e.g. Dr. Lisa Moreno" />
              </label>
              <label className="field">
                Role at the Practice
                <input name="title" autoComplete="off" placeholder="e.g. Office manager" />
              </label>
            </div>
            <label className="field">
              Email
              <input name="email" type="email" required autoComplete="off" placeholder="name@practice.com" />
            </label>
            {state.error && <p className="err" role="alert">{state.error}</p>}
            {state.ok && <p className="ok" role="status">{state.ok} You can invite someone else, or close this.</p>}
            <div className="actions">
              <button type="button" className="btn ghost" onClick={() => setOpen(false)}>
                {state.ok ? "Done" : "Cancel"}
              </button>
              <button className="btn" type="submit" disabled={sending}>
                {sending ? "Sending…" : "Send Invite"}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
