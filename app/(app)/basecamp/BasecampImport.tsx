"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { disconnectBasecamp } from "./actions";

type OnSite = { id: string; name: string; basecamp: string | null };
type BcProject = { id: number; name: string; status: string; description: string | null; kind: string; updated_at: string; app_url: string };
type Props = {
  connected: { account: string | null; href: string; who: string | null; viaKey: boolean } | null;
  canConnect: boolean;
  redirectUri: string;
  onsite: OnSite[];
};
type Progress = {
  bcId: number;
  name: string;
  state: "waiting" | "running" | "done" | "failed";
  projectId?: string;
  postsDone: number;
  postsTotal: number;
  folders: number;
  chats: number;
  messages: number;
  files: number;
  skipped: string[];
  errors: string[];
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
class Fatal extends Error {}

// One import step, retried a couple of times if the connection drops.
async function call<T>(body: Record<string, unknown>): Promise<T> {
  let last = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch("/api/basecamp/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await res.json().catch(() => ({ error: "Lost the connection to OnSite." }));
      if (res.ok) return j as T;
      if (j.fatal || res.status === 403) throw new Fatal(j.error);
      last = j.error;
      if (res.status === 400) break;
    } catch (e) {
      if (e instanceof Fatal) throw e;
      last = "Lost the connection to OnSite.";
    }
    await sleep(2000 * (attempt + 1));
  }
  throw new Error(last || "Something went wrong.");
}

type StepResult = { done: boolean; chats: number; messages: number; files: number; skipped: string[]; subfolders?: { id: number; path: string }[] };

// A step that ran out of time picks up where it left off when called again.
async function untilDone(body: Record<string, unknown>, add: (r: StepResult) => void) {
  for (let i = 0; i < 25; i++) {
    const r = await call<StepResult>(body);
    add(r);
    if (r.done) return r;
  }
  throw new Error("This one is taking too long. Run the import again to finish it.");
}

export default function BasecampImport({ connected, canConnect, redirectUri, onsite }: Props) {
  const [list, setList] = useState<BcProject[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [show, setShow] = useState<"active" | "archived" | "all">("active");
  const [picked, setPicked] = useState<number[]>([]);
  const [targets, setTargets] = useState<Record<number, string>>({});
  const [progress, setProgress] = useState<Progress[]>([]);
  const [running, setRunning] = useState(false);
  const [fatal, setFatal] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();

  useEffect(() => {
    if (!connected) return;
    setList(null);
    setLoadError("");
    setPicked([]);
    // Only the newest request counts (switching accounts fires a new one).
    let live = true;
    fetch("/api/basecamp/projects")
      .then(async (r) => {
        const j = await r.json().catch(() => ({ error: "Couldn't reach Basecamp. Reload to try again." }));
        if (!r.ok) throw new Error(j.error);
        return j.projects as BcProject[];
      })
      .then((projects) => {
        if (!live) return;
        setList(projects);
        // Start each one where it was imported before, or in the OnSite project with the same name.
        const t: Record<number, string> = {};
        for (const p of projects) {
          const mapped = onsite.find((o) => o.basecamp === String(p.id));
          const a = norm(p.name);
          const named = a.length >= 4 ? onsite.find((o) => !o.basecamp && (norm(o.name) === a || norm(o.name).includes(a) || a.includes(norm(o.name)))) : undefined;
          t[p.id] = mapped?.id ?? named?.id ?? "new";
        }
        setTargets(t);
      })
      .catch((e: Error) => live && setLoadError(e.message));
    return () => {
      live = false;
    };
  }, [connected?.href, onsite]);

  useEffect(() => {
    if (!running) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [running]);

  const shown = useMemo(() => (list ?? []).filter((p) => show === "all" || (show === "archived" ? p.status === "archived" : p.status !== "archived")), [list, show]);
  const toggle = (id: number) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const allShown = shown.length > 0 && shown.every((p) => picked.includes(p.id));

  async function run() {
    const chosen = (list ?? []).filter((p) => picked.includes(p.id));
    if (!chosen.length) return;
    setFatal("");
    setRunning(true);
    setProgress(chosen.map((p) => ({ bcId: p.id, name: p.name, state: "waiting", postsDone: 0, postsTotal: 0, folders: 0, chats: 0, messages: 0, files: 0, skipped: [], errors: [] })));
    const update = (bcId: number, f: (p: Progress) => Progress) => setProgress((all) => all.map((p) => (p.bcId === bcId ? f(p) : p)));
    const tally = (bcId: number) => (r: StepResult) =>
      update(bcId, (p) => ({ ...p, chats: p.chats + r.chats, messages: p.messages + r.messages, files: p.files + r.files, skipped: [...p.skipped, ...r.skipped] }));
    try {
      for (const bc of chosen) {
        update(bc.id, (p) => ({ ...p, state: "running" }));
        try {
          const plan = await call<{ projectId: string; posts: { id: number; title: string }[]; vault: { id: number; path: string } | null }>({
            step: "start",
            bcProjectId: bc.id,
            target: targets[bc.id] ?? "new",
          });
          update(bc.id, (p) => ({ ...p, projectId: plan.projectId, postsTotal: plan.posts.length }));
          for (const post of plan.posts) {
            try {
              await untilDone({ step: "post", projectId: plan.projectId, id: post.id }, tally(bc.id));
            } catch (e) {
              if (e instanceof Fatal) throw e;
              update(bc.id, (p) => ({ ...p, errors: [...p.errors, `“${post.title}”: ${(e as Error).message}`] }));
            }
            update(bc.id, (p) => ({ ...p, postsDone: p.postsDone + 1 }));
          }
          const queue = plan.vault ? [plan.vault] : [];
          while (queue.length) {
            const folder = queue.shift()!;
            try {
              const r = await untilDone({ step: "folder", projectId: plan.projectId, id: folder.id, path: folder.path }, tally(bc.id));
              queue.push(...(r.subfolders ?? []));
            } catch (e) {
              if (e instanceof Fatal) throw e;
              update(bc.id, (p) => ({ ...p, errors: [...p.errors, `Folder “${folder.path || "Docs & Files"}”: ${(e as Error).message}`] }));
            }
            update(bc.id, (p) => ({ ...p, folders: p.folders + 1 }));
          }
          update(bc.id, (p) => ({ ...p, state: p.errors.length ? "failed" : "done" }));
        } catch (e) {
          if (e instanceof Fatal) throw e;
          update(bc.id, (p) => ({ ...p, state: "failed", errors: [...p.errors, (e as Error).message] }));
        }
      }
    } catch (e) {
      setFatal((e as Error).message);
      setProgress((all) => all.map((p) => (p.state === "running" ? { ...p, state: "failed" } : p)));
    }
    setRunning(false);
    router.refresh();
  }

  if (!connected) {
    return (
      <section className="box bc-setup">
        <h2>Connect Basecamp</h2>
        {canConnect ? (
          <>
            <p>Sign in to Basecamp as someone who can see every project you want to bring over (the account owner is best).</p>
            <a className="btn" href="/api/basecamp/connect">Connect Basecamp</a>
          </>
        ) : (
          <>
            <p>A one-time setup (about 5 minutes) lets OnSite read your Basecamp account:</p>
            <ol>
              <li>
                Go to <a href="https://launchpad.37signals.com/integrations" target="_blank" rel="noreferrer">launchpad.37signals.com/integrations</a>, sign in
                to Basecamp, and click <b>Register another application</b>.
              </li>
              <li>
                Name: <b>Beshara OnSite</b>. Company: <b>Beshara Builders</b>. Website: <b>https://onsite.besharabuilders.com</b>. Tick <b>Basecamp 5</b>.
              </li>
              <li>
                Redirect URI: <code>{redirectUri}</code>
              </li>
              <li>
                In Vercel (project settings → Environment Variables), add <code>BASECAMP_CLIENT_ID</code> and <code>BASECAMP_CLIENT_SECRET</code> from the app
                you just registered, then redeploy.
              </li>
              <li>Come back here and click Connect Basecamp.</li>
            </ol>
          </>
        )}
      </section>
    );
  }

  return (
    <>
      <section className="box bc-conn">
        <span>
          Connected to <b>{connected.account ?? "Basecamp"}</b>
          {connected.who ? <> as {connected.who}</> : null}.
        </span>
        {!connected.viaKey && (
          <button type="button" className="linkbtn" disabled={pending || running} onClick={() => start(() => disconnectBasecamp())}>
            Disconnect
          </button>
        )}
      </section>

      {progress.length > 0 && (
        <section className="bc-progress" aria-live="polite">
          <div className="sec-h">
            <h2>{running ? "Importing…" : "Import Finished"}</h2>
            {running && <span>Keep this page open until it&apos;s done.</span>}
          </div>
          {fatal && <p className="err">{fatal}</p>}
          {progress.map((p) => (
            <div key={p.bcId} className={`box bc-prog ${p.state}`}>
              <div className="bc-prog-top">
                <b>{p.name}</b>
                <span className="pill">{p.state === "waiting" ? "Waiting" : p.state === "running" ? "Importing" : p.state === "done" ? "Done" : "Finished With Problems"}</span>
                {p.projectId && p.state !== "running" && (
                  <Link className="linkbtn" href={`/projects/${p.projectId}`}>
                    Open in OnSite →
                  </Link>
                )}
              </div>
              {p.state !== "waiting" && (
                <>
                  {p.postsTotal > 0 && (
                    <div className="bc-bar" role="progressbar" aria-valuemin={0} aria-valuemax={p.postsTotal} aria-valuenow={p.postsDone}>
                      <span style={{ width: `${Math.round((p.postsDone / p.postsTotal) * 100)}%` }} />
                    </div>
                  )}
                  <p className="fine">
                    Posts {p.postsDone} of {p.postsTotal} · {p.chats} new {p.chats === 1 ? "chat" : "chats"} · {p.messages} {p.messages === 1 ? "message" : "messages"} ·{" "}
                    {p.files} {p.files === 1 ? "file" : "files"} · {p.folders} {p.folders === 1 ? "folder" : "folders"} checked
                  </p>
                </>
              )}
              {[...p.errors, ...p.skipped].length > 0 && (
                <ul className="bc-issues">
                  {[...p.errors, ...p.skipped].map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              )}
            </div>
          ))}
          {!running && <p className="fine">Running the import again only adds what&apos;s new (new posts, comments and files), so it&apos;s safe to re-run before you switch off Basecamp.</p>}
        </section>
      )}

      <section>
        <div className="sec-h">
          <h2>Basecamp Projects</h2>
          <span className="chips" style={{ marginRight: 0 }}>
            {(["active", "archived", "all"] as const).map((s) => (
              <button key={s} type="button" className="chip" aria-pressed={show === s} onClick={() => setShow(s)}>
                {s === "active" ? "Active" : s === "archived" ? "Archived" : "All"}
              </button>
            ))}
          </span>
        </div>
        {loadError && <p className="err">{loadError}</p>}
        {!list && !loadError && <p className="fine">Loading your Basecamp projects…</p>}
        {list && (
          <div className="box rowlist bc-list">
            {shown.length > 0 && (
              <label className="bc-row bc-all">
                <input
                  type="checkbox"
                  checked={allShown}
                  disabled={running}
                  onChange={() => setPicked((p) => (allShown ? p.filter((id) => !shown.some((s) => s.id === id)) : [...new Set([...p, ...shown.map((s) => s.id)])]))}
                />
                <span>Select all {shown.length}</span>
              </label>
            )}
            {shown.map((p) => {
              const mapped = onsite.find((o) => o.basecamp === String(p.id));
              return (
                <div key={p.id} className="bc-row">
                  <label className="bc-pick">
                    <input type="checkbox" checked={picked.includes(p.id)} disabled={running} onChange={() => toggle(p.id)} />
                    <span>
                      <b>{p.name}</b>
                      {p.status === "archived" && <span className="pill">Archived</span>}
                      {p.kind === "company_hq" && <span className="pill">Company HQ</span>}
                      {p.kind === "team" && <span className="pill">Team</span>}
                      {mapped && <span className="pill bc-done">Imported into {mapped.name}</span>}
                      {p.description && <span className="fine bc-desc">{p.description.replace(/<[^>]+>/g, " ")}</span>}
                    </span>
                  </label>
                  <label className="bc-target">
                    <span className="fine">Into</span>
                    <select
                      value={targets[p.id] ?? "new"}
                      disabled={running || !!mapped}
                      onChange={(e) => setTargets((t) => ({ ...t, [p.id]: e.target.value }))}
                      aria-label={`OnSite project for ${p.name}`}
                    >
                      <option value="new">New OnSite project: {p.name.slice(0, 40)}</option>
                      {onsite
                        .filter((o) => !o.basecamp || o.basecamp === String(p.id))
                        .map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.name}
                          </option>
                        ))}
                    </select>
                  </label>
                </div>
              );
            })}
            {!shown.length && <div className="empty">No {show === "all" ? "" : show} projects in Basecamp.</div>}
          </div>
        )}
        {list && (
          <div className="bc-go">
            <button type="button" className="btn" disabled={running || !picked.length} onClick={run}>
              {running ? "Importing…" : `Import ${picked.length || ""} ${picked.length === 1 ? "Project" : "Projects"}`.replace("  ", " ")}
            </button>
            <span className="fine">New OnSite projects come with the four starter chats; invite the client from Team &amp; Clients afterward.</span>
          </div>
        )}
      </section>
    </>
  );
}
