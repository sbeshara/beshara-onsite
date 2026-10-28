import Link from "next/link";
import Avatar, { CompanyAvatar } from "@/components/Avatar";
import Hero from "@/components/Hero";
import NotifyPrompt from "@/components/NotifyPrompt";
import { getMe } from "@/lib/auth";
import { getPreview } from "@/lib/preview";
import { PHASES, ROLE_LABEL } from "@/lib/constants";
import { dayLabel, fileExt, isImage, plural, shortDate, todayLabel } from "@/lib/format";
import { signUrls } from "@/lib/storage";
import { createClient } from "@/lib/supabase/server";
import { isAdminRole, isTeamRole, type FileRow, type Profile } from "@/lib/types";

const TEAM_COPY = "Every client conversation in one place: weekly updates, questions, selections and the schedule, plus the documents we share.";
const CLIENT_COPY =
  "Stay in touch with your Beshara team throughout your buildout. Weekly updates, questions, selections and the schedule, all in one conversation, plus key documents like your plans.";

type ProjectRow = { id: string; name: string; town: string; scope: string | null; phase: number; project_members: { user_id: string }[] };
type Latest = { chat_id: string; project_id: string; chat_name: string; is_internal: boolean; author_id: string | null; body: string; created_at: string };

function PhaseBar({ phase }: { phase: number }) {
  return (
    <div className="bar" aria-hidden="true">
      {PHASES.map((_, i) => (
        <i key={i} className={i < phase ? "on" : i === phase ? "now" : ""} />
      ))}
    </div>
  );
}

function FileList({ files, projectNames, urls }: { files: FileRow[]; projectNames?: Record<string, string>; urls: Record<string, string> }) {
  return (
    <ul className="flist" style={{ borderTop: 0 }}>
      {files.map((f) => (
        <li key={f.id}>
          <a href={urls[f.storage_path] ?? `/projects/${f.project_id}/files`} target={urls[f.storage_path] ? "_blank" : undefined} rel="noreferrer">
            <span className="ext">{fileExt(f.name)}</span>
            <span style={{ minWidth: 0 }}>
              <span className="nm" style={{ display: "block" }}>{f.name}</span>
              <span className="sm">
                {projectNames ? `${projectNames[f.project_id] ?? ""} · ` : ""}
                {shortDate(f.created_at)}
              </span>
            </span>
          </a>
        </li>
      ))}
    </ul>
  );
}

function Photos({ files, urls }: { files: FileRow[]; urls: Record<string, string> }) {
  return (
    <div className="thumbs">
      {files.map((f) => (
        <a key={f.id} className="thumb" href={urls[f.storage_path]} target="_blank" rel="noreferrer" title={f.name}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={urls[f.storage_path]} alt={f.name} loading="lazy" />
        </a>
      ))}
    </div>
  );
}

export default async function Dashboard() {
  const me = await getMe();
  const preview = await getPreview();
  if (preview) return <ClientDashboard viewerName="" projectId={preview} />;
  return me.role === "client" ? <ClientDashboard viewerName={me.full_name} /> : <TeamDashboard me={me} />;
}

async function TeamDashboard({ me }: { me: Profile }) {
  const supabase = await createClient();
  const weekAgo = new Date(Date.now() - 7 * 864e5).toISOString();
  const [{ data: projectsData }, { data: peopleData }, { data: latestData }, { data: filesData }, { count: weekCount }, { data: unreadData }] = await Promise.all([
    supabase.from("projects").select("id, name, town, scope, phase, project_members(user_id)").order("created_at"),
    supabase.from("profiles").select("id, full_name, email, role, title"),
    supabase.rpc("latest_messages"),
    supabase.from("files").select("*").order("created_at", { ascending: false }).limit(40),
    supabase.from("files").select("id", { count: "exact", head: true }).gte("created_at", weekAgo),
    supabase.rpc("my_unread"),
  ]);
  const unreadProjects = new Set(((unreadData ?? []) as { project_id: string }[]).map((u) => u.project_id));
  const projects = (projectsData ?? []) as ProjectRow[];
  const people = Object.fromEntries(((peopleData ?? []) as Profile[]).map((p) => [p.id, p]));
  const owners = Object.values(people).filter((p) => p.role === "owner");
  const projectNames = Object.fromEntries(projects.map((p) => [p.id, p.name]));
  const needs = ((latestData ?? []) as Latest[])
    .filter((l) => !l.is_internal && l.author_id && people[l.author_id]?.role === "client")
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  const files = (filesData ?? []) as FileRow[];
  const photos = files.filter((f) => isImage(f.mime_type, f.name)).slice(0, 6);
  const docs = files.filter((f) => !isImage(f.mime_type, f.name)).slice(0, 5);
  const urls = await signUrls(supabase, [...photos, ...docs].map((f) => f.storage_path));
  const admin = isAdminRole(me.role);
  const first = me.full_name.split(" ")[0] || "there";

  return (
    <div className="dash">
      <Hero name={first} eyebrow="Beshara OnSite" copy={TEAM_COPY} />
      <NotifyPrompt />
      <section className="hello">
        <p className="summary">
          <span className="today">{todayLabel()}</span> ·{" "}
          {needs.length ? <span className="warn">{plural(needs.length, "client")} waiting on a reply</span> : "No clients are waiting on a reply"}{" "}
          {admin ? `across all ${plural(projects.length, "project")}` : `on your ${plural(projects.length, "project")}`}, and {plural(weekCount ?? 0, "new file")} this week.
        </p>
      </section>
      <div className="dgrid">
        <div className="col">
          <section>
            <div className="sec-h"><h2>Needs a Response</h2><span>Oldest First</span></div>
            <div className="box">
              {needs.length ? (
                needs.map((n) => {
                  const who = people[n.author_id!];
                  return (
                    <Link key={n.chat_id} className="need" href={`/projects/${n.project_id}/chats/${n.chat_id}`}>
                      <Avatar id={who.id} name={who.full_name || who.email} />
                      <span style={{ minWidth: 0 }}>
                        <span className="t">{who.full_name} · {projectNames[n.project_id]} · {n.chat_name}</span>
                        <span className="s" style={{ display: "block" }}>{n.body || "Sent an attachment"}</span>
                      </span>
                      <span className="reply">Reply →</span>
                    </Link>
                  );
                })
              ) : (
                <div className="empty">You&apos;re all caught up.</div>
              )}
            </div>
          </section>
          <section>
            <div className="sec-h">
              <h2>{admin ? "All Projects" : "Your Projects"}</h2>
              {admin ? <Link className="linkbtn" href="/projects/new">+ New Project</Link> : <span>{plural(projects.length, "Active Project")}</span>}
            </div>
            <div className="box">
              {projects.length ? (
                projects.map((p) => {
                  const team = [...owners, ...p.project_members.map((m) => people[m.user_id]).filter((x) => x && isTeamRole(x.role))];
                  return (
                    <Link key={p.id} className="prow" href={`/projects/${p.id}`}>
                      <span style={{ minWidth: 0 }}>
                        <h3>{p.name}{unreadProjects.has(p.id) && <span className="dot" aria-label="New messages" />}</h3>
                        <span className="meta">{[p.town, p.scope].filter(Boolean).join(" · ")}</span>
                      </span>
                      <span className="ph">
                        <PhaseBar phase={p.phase} />
                        <span className="pl"><b>{PHASES[p.phase]}</b> · step {p.phase + 1} of 5</span>
                      </span>
                      <span className="stack">
                        {team.map((t) => <Avatar key={t.id} id={t.id} name={t.full_name || t.email} />)}
                      </span>
                    </Link>
                  );
                })
              ) : (
                <div className="empty">{admin ? "No projects yet. Create the first one with + New Project." : "You haven't been assigned to a project yet."}</div>
              )}
            </div>
          </section>
        </div>
        <aside className="col">
          {photos.length > 0 && (
            <section>
              <div className="sec-h"><h2>Recent Photos</h2></div>
              <div className="box"><Photos files={photos} urls={urls} /></div>
            </section>
          )}
          <section>
            <div className="sec-h"><h2>Recent Files</h2></div>
            <div className="box">
              {docs.length ? <FileList files={docs} projectNames={projectNames} urls={urls} /> : <div className="empty">Files you upload show up here.</div>}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}

// projectId is set when the team is previewing a project as its client.
async function ClientDashboard({ viewerName, projectId }: { viewerName: string; projectId?: string }) {
  const supabase = await createClient();
  const base = supabase.from("projects").select("id, name, town, scope, phase, primary_client_id");
  const { data: projectData } = projectId ? await base.eq("id", projectId) : await base.order("created_at").limit(1);
  const project = projectData?.[0];
  if (!project) {
    return (
      <div className="dash">
        <Hero name={viewerName || "there"} eyebrow="Beshara OnSite" copy={CLIENT_COPY} />
        <div className="box empty">Your project will appear here as soon as Beshara Builders adds you to it.</div>
      </div>
    );
  }
  const [{ data: msgData }, { data: peopleData }, { data: membersData }, { data: filesData }] = await Promise.all([
    supabase.from("messages").select("id, body, created_at, author_id, posted_as, chat_id, chats!inner(name, is_internal), files(name)").eq("project_id", project.id).eq("chats.is_internal", false).order("created_at", { ascending: false }).limit(40),
    supabase.from("profiles").select("id, full_name, email, role, title"),
    supabase.from("project_members").select("user_id").eq("project_id", project.id),
    supabase.from("files").select("*").eq("project_id", project.id).eq("is_internal", false).order("created_at", { ascending: false }).limit(20),
  ]);
  const people = Object.fromEntries(((peopleData ?? []) as Profile[]).map((p) => [p.id, p]));
  const name = projectId ? (project.primary_client_id && people[project.primary_client_id]?.full_name) || "" : viewerName;
  type Msg = { id: string; body: string; created_at: string; author_id: string | null; posted_as: string | null; chat_id: string; chats: { name: string } | null; files: { name: string }[] };
  const updates = ((msgData ?? []) as unknown as Msg[]).filter((m) => m.author_id && people[m.author_id] && isTeamRole(people[m.author_id].role)).slice(0, 4);
  const team = [
    ...Object.values(people).filter((p) => p.role === "owner"),
    ...(membersData ?? []).map((m) => people[m.user_id]).filter((p) => p && p.role === "construction"),
  ];
  const files = (filesData ?? []) as FileRow[];
  const photos = files.filter((f) => isImage(f.mime_type, f.name)).slice(0, 3);
  const docs = files.filter((f) => !isImage(f.mime_type, f.name)).slice(0, 4);
  const urls = await signUrls(supabase, [...photos, ...docs].map((f) => f.storage_path));

  return (
    <div className="dash">
      <Hero name={name || "there"} eyebrow={`Beshara OnSite · ${project.name}`} copy={CLIENT_COPY} />
      {!projectId && <NotifyPrompt />}
      <section className="hello">
        <p className="summary">
          Your project is in <b>{PHASES[project.phase]}</b>, step {project.phase + 1} of 5. Everything your Beshara team shares with you is here.
        </p>
      </section>
      <div className="box">
        <div className="steps">
          {PHASES.map((ph, i) => (
            <div key={ph} className={`step ${i < project.phase ? "done" : i === project.phase ? "now" : ""}`}>
              <i />
              <span>{ph}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="dgrid">
        <div className="col">
          <section>
            <div className="sec-h"><h2>Latest from Your Team</h2></div>
            <div className="box">
              {updates.length ? (
                updates.map((m) => {
                  const company = m.posted_as === "company";
                  const who = people[m.author_id!];
                  const name = company ? "Beshara Builders" : who.full_name;
                  return (
                    <div key={m.id} className="upd">
                      {company ? <CompanyAvatar /> : <Avatar id={who.id} name={who.full_name || who.email} />}
                      <div style={{ minWidth: 0 }}>
                        <div className="t">
                          <b style={{ color: "var(--ink)" }}>{name}</b> · {dayLabel(m.created_at)} · in{" "}
                          <Link className="reply" href={`/projects/${project.id}/chats/${m.chat_id}`}>{m.chats?.name}</Link>
                        </div>
                        <div className="body">{m.body || m.files.map((f) => f.name).join(", ") || "Sent an attachment"}</div>
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="empty">Updates from your Beshara team will show up here.</div>
              )}
            </div>
          </section>
        </div>
        <aside className="col">
          <section>
            <div className="sec-h"><h2>Recent Files</h2></div>
            <div className="box">
              {photos.length > 0 && <Photos files={photos} urls={urls} />}
              {docs.length > 0 && <FileList files={docs} urls={urls} />}
              {!files.length && <div className="empty">Documents your team shares will show up here.</div>}
            </div>
          </section>
          <section>
            <div className="sec-h"><h2>Your Beshara Team</h2></div>
            <div className="box team">
              {team.map((p) => (
                <div key={p.id} className="member">
                  <Avatar id={p.id} name={p.full_name || p.email} />
                  <div><b>{p.full_name || p.email}</b><small>{ROLE_LABEL[p.role]}</small></div>
                </div>
              ))}
            </div>
          </section>
        </aside>
      </div>
      <p className="tagline">Building the spaces where care happens.</p>
    </div>
  );
}
