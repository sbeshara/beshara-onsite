"use client";

import { useState } from "react";

type Client = { bcId: number; name: string; email: string; title: string | null; company: string | null; status: "member" | "account" | "new" | "team" };
type Project = { projectId: string; name: string; announcedAt: string | null; clients: Client[]; error?: string };
type Result = { invited: string[]; added: string[]; skipped: string[]; posted: boolean; error?: string };

const STATUS: Record<Client["status"], string> = {
  new: "Will get an OnSite invite",
  account: "Has an OnSite login · will be added to this project",
  member: "Already in this OnSite project",
  team: "On the Beshara team · skipped",
};
const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" });

// Invite each imported project's Basecamp clients into OnSite, then post an
// announcement on that project's Basecamp Message Board (clients only), which
// Basecamp emails to them.
export default function TellClients({ signer }: { signer: string }) {
  const [subject, setSubject] = useState("We've moved to Beshara OnSite");
  const [body, setBody] = useState(
    `Hi everyone,\n\nWe've moved our project communication from Basecamp to Beshara OnSite, our new client portal. You'll receive an email invite from Beshara OnSite shortly. Click the link, choose a password, and you'll find our past messages and files for your project already there.\n\nFrom now on, please send questions and updates through OnSite instead of Basecamp.\n\nThank you,\n${signer}\nBeshara Builders`,
  );
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [pickedProjects, setPickedProjects] = useState<string[]>([]);
  const [pickedEmails, setPickedEmails] = useState<Record<string, string[]>>({});
  const [post, setPost] = useState(true);
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
    setPickedProjects(list.filter((p) => p.clients.length && !p.announcedAt).map((p) => p.projectId));
    setPickedEmails(Object.fromEntries(list.map((p) => [p.projectId, p.clients.filter((c) => c.status === "new" || c.status === "account").map((c) => c.email)])));
  }

  const chosen = (projects ?? []).filter((p) => pickedProjects.includes(p.projectId));
  const inviteCount = chosen.reduce((n, p) => n + (pickedEmails[p.projectId]?.length ?? 0), 0);
  const notifyCount = post ? chosen.reduce((n, p) => n + p.clients.length, 0) : 0;

  async function run() {
    const what = [
      inviteCount ? `invite ${inviteCount} ${inviteCount === 1 ? "client" : "clients"} to OnSite` : "",
      post ? `post your message in ${chosen.length} Basecamp ${chosen.length === 1 ? "project" : "projects"} (Basecamp emails it to ${notifyCount} ${notifyCount === 1 ? "client" : "clients"})` : "",
    ].filter(Boolean);
    if (!what.length || !window.confirm(`This will ${what.join(" and ")}. Continue?`)) return;
    setRunning(true);
    for (const p of chosen) {
      setResults((r) => ({ ...r, [p.projectId]: "running" }));
      let r: Result;
      try {
        const res = await fetch("/api/basecamp/announce", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId: p.projectId, emails: pickedEmails[p.projectId] ?? [], post, subject, body }),
        });
        r = await res.json().catch(() => ({ error: "Lost the connection to OnSite." }));
        if (!res.ok) r = { invited: [], added: [], skipped: [], posted: false, error: r.error ?? "Something went wrong." };
      } catch {
        r = { invited: [], added: [], skipped: [], posted: false, error: "Lost the connection to OnSite." };
      }
      setResults((all) => ({ ...all, [p.projectId]: r }));
    }
    setRunning(false);
  }

  return (
    <section>
      <div className="sec-h">
        <h2>Tell Your Clients</h2>
      </div>
      <p className="fine" style={{ maxWidth: "70ch", marginBottom: 12 }}>
        For each imported project: invites its Basecamp clients into the OnSite project, then posts this message on the project&apos;s Basecamp Message
        Board, visible to clients, so Basecamp emails it to them. Your team isn&apos;t notified. Projects you&apos;ve already announced are left unticked.
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
        <label className="tc-post">
          <input type="checkbox" checked={post} onChange={(e) => setPost(e.target.checked)} disabled={running} /> Post this message in Basecamp
        </label>
      </div>

      {!projects ? (
        <div className="bc-go">
          <button type="button" className="btn" onClick={load} disabled={loading}>
            {loading ? "Looking up clients…" : "Find My Basecamp Clients"}
          </button>
          {error && <span className="err">{error}</span>}
        </div>
      ) : (
        <>
          <div className="box rowlist bc-list" style={{ marginTop: 12 }}>
            {!projects.length && <div className="empty">Import a project first, then its clients show up here.</div>}
            {projects.map((p) => {
              const r = results[p.projectId];
              return (
                <div key={p.projectId} className="tc-proj">
                  <label className="bc-pick">
                    <input
                      type="checkbox"
                      checked={pickedProjects.includes(p.projectId)}
                      disabled={running || !p.clients.length}
                      onChange={() => setPickedProjects((all) => (all.includes(p.projectId) ? all.filter((x) => x !== p.projectId) : [...all, p.projectId]))}
                    />
                    <span>
                      <b>{p.name}</b>
                      {p.announcedAt && <span className="pill bc-done">Announced {day(p.announcedAt)}</span>}
                      {!p.clients.length && !p.error && <span className="pill">No clients in Basecamp</span>}
                      {r === "running" && <span className="pill">Sending…</span>}
                      {r && r !== "running" && <span className={`pill ${r.error ? "" : "bc-done"}`}>{r.error ? "Problem" : "Done"}</span>}
                    </span>
                  </label>
                  {p.error && <p className="err">{p.error}</p>}
                  {p.clients.length > 0 && (
                    <ul className="tc-clients">
                      {p.clients.map((c) => {
                        const can = c.status === "new" || c.status === "account";
                        const on = pickedEmails[p.projectId]?.includes(c.email) ?? false;
                        return (
                          <li key={c.bcId}>
                            <label>
                              <input
                                type="checkbox"
                                checked={can && on}
                                disabled={!can || running}
                                onChange={() =>
                                  setPickedEmails((all) => ({ ...all, [p.projectId]: on ? all[p.projectId].filter((e) => e !== c.email) : [...(all[p.projectId] ?? []), c.email] }))
                                }
                              />
                              <span>
                                <b>{c.name}</b> · {c.email}
                                {c.company ? ` · ${c.company}` : ""}
                                <small>{STATUS[c.status]}</small>
                              </span>
                            </label>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  {r && r !== "running" && (
                    <p className={r.error ? "err" : "ok"} style={{ margin: "4px 0 0 28px" }}>
                      {r.error ??
                        ([
                          r.invited.length ? `Invited ${r.invited.join(", ")}.` : "",
                          r.added.length ? `Added ${r.added.join(", ")} (already had a login).` : "",
                          r.posted ? "Posted in Basecamp." : "",
                          ...r.skipped,
                        ]
                          .filter(Boolean)
                          .join(" ") || "Nothing to do.")}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
          <div className="bc-go">
            <button type="button" className="btn" onClick={run} disabled={running || !chosen.length || (!post && !inviteCount)}>
              {running ? "Sending…" : `${post ? "Invite & Post to" : "Invite Clients in"} ${chosen.length} ${chosen.length === 1 ? "Project" : "Projects"}`}
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
