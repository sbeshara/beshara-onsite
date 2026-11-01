import Link from "next/link";
import { redirect } from "next/navigation";
import PeopleManager from "@/app/(app)/projects/[id]/people/PeopleManager";
import { getMe } from "@/lib/auth";
import { PHASES } from "@/lib/constants";
import { plural } from "@/lib/format";
import { loadProjectPeople } from "@/lib/project-people";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { isAdminRole, type Profile } from "@/lib/types";
import TeamManager from "./TeamManager";

export const metadata = { title: "Team & Access · Beshara OnSite" };

// Jobs in construction first, as in the side menu.
const GROUP_ORDER = [2, 3, 1, 0, 4];

export default async function TeamPage({ searchParams }: { searchParams: Promise<{ view?: string; job?: string }> }) {
  const me = await getMe();
  if (!isAdminRole(me.role)) redirect("/");
  const { view, job } = await searchParams;
  const byJob = view === "jobs";
  const supabase = await createClient();
  const [{ data: people }, { data: members }, { data: projects }, { data: users }] = await Promise.all([
    supabase.from("profiles").select("*").neq("role", "client").order("full_name"),
    supabase.from("project_members").select("user_id, project_id, profiles(role)"),
    supabase.from("projects").select("id, name, town, phase").order("name"),
    createAdminClient().auth.admin.listUsers({ perPage: 1000 }),
  ]);
  const assigned: Record<string, string[]> = {};
  for (const m of members ?? []) (assigned[m.user_id] ??= []).push(m.project_id);
  // When each person last signed in; null means they haven't accepted their invite yet.
  const lastSignIn: Record<string, string | null> = {};
  for (const u of users?.users ?? []) lastSignIn[u.id] = u.last_sign_in_at ?? null;
  const team = ((people ?? []) as Profile[]).sort((a, b) => Number(!lastSignIn[a.id]) - Number(!lastSignIn[b.id]));

  const tabs = (
    <nav className="tabs team-tabs" aria-label="View">
      <Link className="tab" href="/team" aria-current={!byJob ? "page" : undefined}>
        By Person
      </Link>
      <Link className="tab" href="/team?view=jobs" aria-current={byJob ? "page" : undefined}>
        By Job
      </Link>
    </nav>
  );

  if (!byJob) {
    return (
      <div className="page">
        <div className="page-h">
          <h1>Team &amp; Access</h1>
          <p>
            The Principal Contractor and Admins see every job. Construction Management only sees the jobs ticked under their name. Changes save as
            you tick.
          </p>
        </div>
        {tabs}
        <TeamManager me={{ id: me.id, role: me.role }} people={team} projects={projects ?? []} assigned={assigned} lastSignIn={lastSignIn} />
      </div>
    );
  }

  // By Job: everyone on each job, and the selected job's Team & Clients.
  type Row = { user_id: string; project_id: string; profiles: { role: string } | null };
  const counts: Record<string, { team: number; clients: number; pending: number }> = {};
  for (const m of (members ?? []) as unknown as Row[]) {
    const c = (counts[m.project_id] ??= { team: 0, clients: 0, pending: 0 });
    if (m.profiles?.role === "client") {
      c.clients++;
      if (!lastSignIn[m.user_id]) c.pending++;
    } else if (m.profiles?.role === "construction") c.team++;
  }
  const list = projects ?? [];
  const selectedId = list.some((p) => p.id === job) ? job! : (list.find((p) => p.phase === 2) ?? list[0])?.id;
  const selected = selectedId ? await loadProjectPeople(selectedId) : null;

  return (
    <div className="page">
      <div className="page-h">
        <h1>Team &amp; Access</h1>
        <p>Pick a job to see everyone on it, your team and the client&apos;s contacts, and add people right there.</p>
      </div>
      {tabs}
      <div className="byjob">
        <nav className="box byjob-list" aria-label="Jobs">
          {GROUP_ORDER.map((ph) => {
            const group = list.filter((p) => p.phase === ph);
            if (!group.length) return null;
            return (
              <div key={ph} className={`pgroup ph${ph}`}>
                <div className="byjob-h">
                  <span>{PHASES[ph]}</span>
                  <span className="pg-count">{group.length}</span>
                </div>
                {group.map((p) => {
                  const c = counts[p.id] ?? { team: 0, clients: 0, pending: 0 };
                  return (
                    <Link key={p.id} className="proj" href={`/team?view=jobs&job=${p.id}`} aria-current={p.id === selectedId ? "page" : undefined}>
                      <span className={`pdot ph${p.phase}`} aria-hidden="true" />
                      <span className="n">{p.name}</span>
                      <span />
                      <span className="m">
                        {plural(c.team, "PM")} · {plural(c.clients, "client")}
                        {!c.clients ? <b className="byjob-warn"> · no client</b> : c.pending ? <b className="byjob-warn"> · {c.pending} invite pending</b> : null}
                      </span>
                    </Link>
                  );
                })}
              </div>
            );
          })}
          {!list.length && <p className="fine" style={{ padding: 16 }}>No projects yet.</p>}
        </nav>
        <div className="byjob-detail">
          {selected ? (
            <>
              <div className="byjob-title">
                <h2>{selected.name}</h2>
                <Link className="linkbtn" href={`/projects/${selected.projectId}`}>
                  Open Project →
                </Link>
              </div>
              <PeopleManager
                key={selected.projectId}
                projectId={selected.projectId}
                primaryClientId={selected.primaryClientId}
                staff={selected.staff}
                assigned={selected.assigned}
                clients={selected.clients}
                status={selected.status}
              />
            </>
          ) : (
            <p className="fine">Pick a job on the left.</p>
          )}
        </div>
      </div>
    </div>
  );
}
