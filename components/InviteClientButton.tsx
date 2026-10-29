"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { addClientContact, jobTreadContacts, type Result } from "@/app/actions";
import type { JobContact } from "@/lib/jobtread";

// Invite a client contact without leaving the project.
// With reminder set, it shows the "no client yet" banner instead of a plain
// button; the banner hides once a client exists, but stays open while in use.
type Props = { projectId: string; projectName: string; reminder?: boolean; hasClient?: boolean };

export default function InviteClientButton({ projectId, projectName, reminder, hasClient }: Props) {
  const [open, setOpen] = useState(false);
  const [state, action, sending] = useActionState<Result, FormData>(addClientContact.bind(null, projectId), {});
  const form = useRef<HTMLFormElement>(null);
  const [fields, setFields] = useState({ name: "", title: "", email: "" });
  // Contacts on the linked JobTread job, offered as one-click fill-ins.
  const [suggest, setSuggest] = useState<JobContact[] | null>(null);
  const loadSuggestions = () => jobTreadContacts(projectId).then((r) => setSuggest(r.contacts));
  useEffect(() => {
    if (!state.ok) return;
    setFields({ name: "", title: "", email: "" });
    loadSuggestions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);
  const openForm = () => {
    setOpen(true);
    if (!suggest) loadSuggestions();
  };
  const set = (k: keyof typeof fields) => (e: React.ChangeEvent<HTMLInputElement>) => setFields((f) => ({ ...f, [k]: e.target.value }));

  if (reminder && hasClient && !open) return null;
  const button = (
    <button type="button" className={reminder ? "btn" : "linkbtn"} onClick={openForm}>
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
            {suggest && suggest.length > 0 && (
              <div className="jt-suggest">
                <b>From JobTread</b>
                {suggest.map((c) => (
                  <button
                    key={c.email}
                    type="button"
                    className={`jt-contact ${fields.email === c.email ? "on" : ""}`}
                    onClick={() => setFields({ name: c.name, title: c.title ?? "", email: c.email })}
                  >
                    <span>
                      {c.name}
                      {c.primary && <em> · Main contact</em>}
                    </span>
                    <small>{c.email}</small>
                  </button>
                ))}
                <small className="fine">Tap a contact to fill in the form, then check it and send.</small>
              </div>
            )}
            <div className="row2">
              <label className="field">
                Name
                <input name="name" required autoFocus autoComplete="off" placeholder="e.g. Dr. Lisa Moreno" value={fields.name} onChange={set("name")} />
              </label>
              <label className="field">
                Role at the Practice
                <input name="title" autoComplete="off" placeholder="e.g. Office manager" value={fields.title} onChange={set("title")} />
              </label>
            </div>
            <label className="field">
              Email
              <input name="email" type="email" required autoComplete="off" placeholder="name@practice.com" value={fields.email} onChange={set("email")} />
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
