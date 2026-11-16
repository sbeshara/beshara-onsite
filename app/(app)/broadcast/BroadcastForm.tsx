"use client";

import { useState, useTransition } from "react";
import { messageAllClients } from "@/app/actions";

type Row = { id: string; name: string; town: string; phase: string; clients: number };

const DEFAULT_BODY = `**Get OnSite on your phone**

You can now keep Beshara OnSite on your home screen like an app.

**iPhone:** open https://onsite.besharabuilders.com/install in **Safari**, tap the **Share** button, then **Add to Home Screen** → **Add**. Open OnSite from the new icon and sign in once. It stays signed in.

**Android:** open the same link in **Chrome** and tap **Install OnSite**.

Questions? Just reply here.`;

export default function BroadcastForm({ projects }: { projects: Row[] }) {
  const [chatName, setChatName] = useState("Get the OnSite App");
  const [body, setBody] = useState(DEFAULT_BODY);
  const [picked, setPicked] = useState<string[]>(projects.filter((p) => p.clients > 0).map((p) => p.id));
  const [result, setResult] = useState<{ ok?: string; error?: string }>({});
  const [pending, start] = useTransition();
  const chosen = projects.filter((p) => picked.includes(p.id));
  const people = chosen.reduce((n, p) => n + p.clients, 0);
  const toggle = (id: string) => setPicked((all) => (all.includes(id) ? all.filter((x) => x !== id) : [...all, id]));

  function send() {
    const s = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
    if (!window.confirm(`Post "${chatName.trim()}" to ${s(chosen.length, "project")}? ${s(people, "client")} will be notified.`)) return;
    setResult({});
    start(async () => {
      const r = await messageAllClients(chatName, body, picked);
      setResult(r);
      if (r.ok) setPicked([]);
    });
  }

  return (
    <div className="bcast">
      <section className="box bcast-msg">
        <label className="field">
          Chat name
          <input value={chatName} onChange={(e) => setChatName(e.target.value)} maxLength={60} disabled={pending} />
        </label>
        <label className="field">
          Message
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={13} maxLength={5000} disabled={pending} />
        </label>
        <p className="fine">Put **two stars** around words to make them bold. Links starting with https:// become tappable.</p>
      </section>
      <section className="box bcast-list">
        <div className="bcast-h">
          <b>Send to</b>
          <span className="fine">
            {chosen.length} of {projects.length} projects · {people} {people === 1 ? "client" : "clients"}
          </span>
          <button type="button" className="linkbtn" onClick={() => setPicked(projects.filter((p) => p.clients > 0).map((p) => p.id))} disabled={pending}>
            All with clients
          </button>
          <button type="button" className="linkbtn" onClick={() => setPicked([])} disabled={pending}>
            None
          </button>
        </div>
        {projects.map((p) => (
          <label key={p.id} className={`bcast-row ${p.clients ? "" : "dim"}`}>
            <input type="checkbox" checked={picked.includes(p.id)} onChange={() => toggle(p.id)} disabled={pending} />
            <span>
              <b>{p.name}</b>
              <small>
                {[p.town, p.phase].filter(Boolean).join(" · ")} · {p.clients ? `${p.clients} ${p.clients === 1 ? "client" : "clients"}` : "no clients yet"}
              </small>
            </span>
          </label>
        ))}
      </section>
      <div className="bcast-go">
        <button type="button" className="btn" onClick={send} disabled={pending || !chosen.length || !chatName.trim() || !body.trim()}>
          {pending ? "Posting…" : `Post to ${chosen.length} ${chosen.length === 1 ? "Project" : "Projects"}`}
        </button>
        {result.ok && <span className="ok">{result.ok}</span>}
        {result.error && <span className="err">{result.error}</span>}
      </div>
    </div>
  );
}
