"use client";

import { useActionState, useState, useTransition } from "react";
import { deleteContact, deleteCustomer, saveContact, type Result } from "../../actions";

type Contact = { id: string; name: string; title: string | null; email: string | null; phone: string | null; is_primary: boolean; profile_id: string | null };

function ContactForm({ customerId, contact, onDone }: { customerId: string; contact?: Contact; onDone?: () => void }) {
  const [state, action, pending] = useActionState<Result, FormData>(async (p, f) => {
    const r = await saveContact(p, f);
    if (r.ok) onDone?.();
    return r;
  }, {});
  return (
    <form className="iform" action={action}>
      <input type="hidden" name="customer_id" value={customerId} />
      {contact && <input type="hidden" name="id" value={contact.id} />}
      <div className="row2">
        <label>Name<input name="name" required defaultValue={contact?.name} /></label>
        <label>Title<input name="title" defaultValue={contact?.title ?? ""} placeholder="e.g. Office manager" /></label>
      </div>
      <div className="row2">
        <label>Email<input name="email" type="email" defaultValue={contact?.email ?? ""} /></label>
        <label>Phone<input name="phone" type="tel" defaultValue={contact?.phone ?? ""} /></label>
      </div>
      <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}>
        <input type="checkbox" name="is_primary" defaultChecked={contact?.is_primary} style={{ width: "auto" }} /> Main contact
      </label>
      {state.error && <p className="err" role="alert">{state.error}</p>}
      <div className="actions" style={{ justifyContent: "flex-start" }}>
        <button className="btn" type="submit" disabled={pending}>{pending ? "Saving…" : contact ? "Save contact" : "Add contact"}</button>
        {onDone && <button className="btn ghost" type="button" onClick={onDone}>Cancel</button>}
      </div>
    </form>
  );
}

export default function Contacts({ customerId, contacts, canDelete }: { customerId: string; contacts: Contact[]; canDelete: boolean }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [msg, setMsg] = useState<Result>({});
  const [pending, start] = useTransition();
  const [confirm, setConfirm] = useState(false);
  return (
    <>
      <section className="ocard">
        <div className="sec-h" style={{ marginBottom: 0 }}><h2>Contacts</h2>{!adding && <button className="linkbtn" onClick={() => setAdding(true)}>+ Add contact</button>}</div>
        <div className="box rowlist">
          {contacts.map((c) =>
            editing === c.id ? (
              <ContactForm key={c.id} customerId={customerId} contact={c} onDone={() => setEditing(null)} />
            ) : (
              <div key={c.id} className="rowitem" style={{ gridTemplateColumns: "minmax(0,1fr) auto" }}>
                <div style={{ minWidth: 0 }}>
                  <b>{c.name}</b>{c.is_primary && <span className="pill" style={{ marginLeft: 6 }}>Main</span>}
                  <small>{[c.title, c.email, c.phone].filter(Boolean).join(" · ") || "No details yet"}</small>
                  {c.profile_id && <small>Has an OnSite login</small>}
                </div>
                <span className="cbtns">
                  <button className="linkbtn" onClick={() => setEditing(c.id)}>Edit</button>
                  <button className="linkbtn" disabled={pending} onClick={() => start(async () => setMsg(await deleteContact(c.id, customerId)))}>Remove</button>
                </span>
              </div>
            ),
          )}
          {!contacts.length && !adding && <p className="empty-hint">No contacts yet.</p>}
          {adding && <ContactForm customerId={customerId} onDone={() => setAdding(false)} />}
        </div>
        {msg.error && <p className="err" role="alert">{msg.error}</p>}
      </section>
      {canDelete && (
        <section className="ocard">
          <h2>Delete customer</h2>
          <p className="fine">Only possible when the customer has no jobs.</p>
          <div className="actions" style={{ justifyContent: "flex-start" }}>
            {confirm ? (
              <>
                <button className="btn" style={{ background: "#B3261E" }} disabled={pending} onClick={() => start(async () => setMsg(await deleteCustomer(customerId)))}>Delete for good</button>
                <button className="btn ghost" onClick={() => setConfirm(false)}>Cancel</button>
              </>
            ) : (
              <button className="btn ghost" onClick={() => setConfirm(true)}>Delete customer</button>
            )}
          </div>
        </section>
      )}
    </>
  );
}
