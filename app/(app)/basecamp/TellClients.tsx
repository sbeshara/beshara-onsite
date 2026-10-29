"use client";

import { useState } from "react";

type Client = { bcId: number; name: string; email: string; title: string | null; company: string | null; status: "member" | "account" | "new" | "team" };
type Project = { projectId: string; name: string; announcedAt: string | null; clients: Client[]; error?: string };
type Result = { posted?: number; error?: string };

// Whether each Basecamp client is set up in the matching OnSite project, as a
// heads-up before telling them to look for their invite.
const STATUS: Record<Client["status"], string> = {
  member: "In this OnSite project",
  account: "Has an OnSite login, but isn't on this OnSite project",
  new: "Not in OnSite yet",
  team: "Beshara team member",
};
const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" });

// Posts an announcement on each imported project's Basecamp Message Board,
// visible to clients, so Basecamp emails it to them (not the team).
export default function TellClients({ signer }: { signer: string }) {
  const [subject, setSubject] = useState("We've moved to Beshara OnSite");
  const [body, setBody] = useState(
    `Hi everyone,\n\nWe've moved our project communication from Basecamp to Beshara OnSite, our new client portal. You should already have an email invite from Beshara OnSite. Click the link in it, choose a password, and you'll find our past messages and files for your project already there. If you can't find the invite, reply here and we'll send a new one.\n\nFrom now on, please send questions and updates through OnSite instead of Basecamp.\n\nThank you,\n${signer}\nBeshara Builders`,
  );
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<Record<string, Result | "running">>({});

  async function load() {
    setLoading(true);
    setError("");
    const res = await fetch("/api/basecamp/clients");
    const j = await res.json().catch(() => ({ error: "Couldn't reach Basecamp. Try again." }));
    setLoading(false);
    if (!res.ok) return setError(j.error);
    const list = j.projects as Project[];
    setProjects(list);
    setPicked(list.filter((p) => p.clients.length && !p.announcedAt).map((p) => p.projectId));
  }

  const chosen = (projects ?? []).filter((p) => picked.includes(p.projectId));
  const notifyCount = chosen.reduce((n, p) => n + p.clients.length, 0);

  async function run() {
    const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
    if (!window.confirm(`Post your message in ${plural(chosen.length, "Basecamp project")}? Basecamp will email it to ${plural(notifyCount, "client")}.`)) return;
    setRunning(true);
    for (const p of chosen) {
      setResults((r) => ({ ...r, [p.projectId]: "running" }));
      let r: Result;
      try {
        const res = await fetch("/api/basecamp/announce", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId: p.projectId, subject, body }),
        });
        r = await res.json().catch(() => ({ error: "Lost the connection to OnSite." }));
        if (!res.ok) r = { error: r.error ?? "Something went wrong." };
      } catch {
        r = { error: "Lost the connection to OnSite." };
      }
      setResults((all) => ({ ...all, [p.projectId]: r }));
      if (!r.error) setPicked((all) => all.filter((x) => x !== p.projectId));
    }
    setRunning(false);
  }

  return (
    <section>
      <div className="sec-h">
        <h2>Tell Your Clients</h2>
      </div>
      <p className="fine" style={{ maxWidth: "70ch", marginBottom: 12 }}>
        Posts this message on each imported project&apos;s Basecamp Message Board, visible to clients, so Basecamp emails it to the project&apos;s
        clients. Your team isn&apos;t notified. Projects you&apos;ve already announced are left unticked.
      </p>
      <div className="box tc-msg">
        <label>
          <span className="fine">Subject</span>
          <input value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={200} disabled={running} />
        </label>
        <label>
          <span className="fine">Message</span>
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={10} maxLength={5000} disabled={running} />
        </label>
      </div>

      {!projects ? (
        <div className="bc-go">
          <button type="button" className="btn" onClick={load} disabled={loading}>
            {loading ? "Looking up clients…" : "Choose Projects"}
          </button>
          {error && <span className="err">{error}</span>}
        </div>
      ) : (
        <>
          <div className="box rowlist bc-list" style={{ marginTop: 12 }}>
            {!projects.length && <div className="empty">Import a project first, then it shows up here.</div>}
            {projects.map((p) => {
              const r = results[p.projectId];
              return (
                <div key={p.projectId} className="tc-proj">
                  <label className="bc-pick">
                    <input
                      type="checkbox"
                      checked={picked.includes(p.projectId)}
                      disabled={running || !p.clients.length}
                      onChange={() => setPicked((all) => (all.includes(p.projectId) ? all.filter((x) => x !== p.projectId) : [...all, p.projectId]))}
                    />
                    <span>
                      <b>{p.name}</b>
                      {p.announcedAt && <span className="pill bc-done">Announced {day(p.announcedAt)}</span>}
                      {!p.clients.length && !p.error && <span className="pill">No clients in Basecamp</span>}
                      {r === "running" && <span className="pill">Posting…</span>}
                    </span>
                  </label>
                  {p.error && <p className="err">{p.error}</p>}
                  {p.clients.length > 0 && (
                    <ul className="tc-clients">
                      {p.clients.map((c) => (
                        <li key={c.bcId}>
                          <b>{c.name}</b> · {c.email}
                          {c.company ? ` · ${c.company}` : ""}
                          <small className={c.status === "member" ? "" : "tc-warn"}>{STATUS[c.status]}</small>
                        </li>
                      ))}
                    </ul>
                  )}
                  {r && r !== "running" && (
                    <p className={r.error ? "err" : "ok"} style={{ margin: "4px 0 0 28px" }}>
                      {r.error ?? `Posted in Basecamp. Emailed to ${r.posted} ${r.posted === 1 ? "client" : "clients"}.`}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
          <div className="bc-go">
            <button type="button" className="btn" onClick={run} disabled={running || !chosen.length}>
              {running ? "Posting…" : `Post to ${chosen.length} ${chosen.length === 1 ? "Project" : "Projects"}`}
            </button>
            <button type="button" className="linkbtn" onClick={load} disabled={running || loading}>
              Refresh List
            </button>
          </div>
        </>
      )}
    </section>
  );
}
