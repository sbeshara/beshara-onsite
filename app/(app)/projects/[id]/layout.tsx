import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import Avatar from "@/components/Avatar";
import InviteClientButton from "@/components/InviteClientButton";
import PhaseControl from "@/components/PhaseControl";
import ProjectTabs from "@/components/ProjectTabs";
import { getMe } from "@/lib/auth";
import { getAccess } from "@/lib/access";
import { getPreview } from "@/lib/preview";
import { canViewProject, projectViewer } from "@/lib/viewas";
import { createClient } from "@/lib/supabase/server";
import { isAdminRole, isTeamRole, type Profile } from "@/lib/types";

export default async function ProjectLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await getMe();
  const access = await getAccess();
  const preview = await getPreview();
  if (preview && preview !== id) redirect(`/projects/${preview}`);
  const v = await projectViewer(id);
  if (v.viewAs && !canViewProject(v.viewAs, id)) redirect("/");
  const supabase = await createClient();
  const fileCountQuery = supabase.from("files").select("id", { count: "exact", head: true }).eq("project_id", id);
  const [{ data: project }, { data: members }, { data: owners }, { count: fileCount }] = await Promise.all([
    supabase.from("projects").select("id, name, town, scope, phase, status").eq("id", id).maybeSingle(),
    supabase.from("project_members").select("user_id, profiles(*)").eq("project_id", id),
    supabase.from("profiles").select("*").eq("role", "owner"),
    v.clientOnly ? fileCountQuery.eq("is_internal", false) : fileCountQuery,
  ]);
  if (!project) notFound();
  // Clients (and previews as a client) get a Proposals tab once something's been sent.
  const { data: sent } = !isTeamRole(me.role) || v.clientOnly ? await supabase.rpc("client_proposals", { p_project: id }) : { data: [] };
  const proposalCount = Array.isArray(sent) ? sent.length : 0;
  const memberProfiles = ((members ?? []) as unknown as { profiles: Profile | null }[]).map((m) => m.profiles).filter(Boolean) as Profile[];
  const everyone = [
    ...memberProfiles.filter((p) => p.role === "client"),
    ...((owners ?? []) as Profile[]),
    ...memberProfiles.filter((p) => p.role !== "client"),
  ];

  return (
    <div className="pview">
      <div className="phead">
        <div className="phead-row">
          <div>
            <h1>{project.name}</h1>
            <div className="sub">{[project.town ? `${project.town}, NJ` : "", project.scope].filter(Boolean).join(" · ")}</div>
          </div>
          <div className="people">
            <div className="stack">
              {everyone.map((p) => <Avatar key={p.id} id={p.id} name={p.full_name || p.email} url={p.avatar_url} />)}
            </div>
            <span className="sub">{everyone.length} {everyone.length === 1 ? "Person" : "People"}</span>
            {isAdminRole(me.role) && !v.readOnly && (
              <>
                <InviteClientButton projectId={id} projectName={project.name} />
                <a className="linkbtn" href={`/preview?project=${id}`}>View as Client</a>
                <Link className="linkbtn" href={`/projects/${id}/people`}>Team &amp; Clients</Link>
              </>
            )}
          </div>
        </div>
        <PhaseControl projectId={id} phase={project.phase} status={project.status} mode={!isTeamRole(me.role) || v.readOnly ? "client" : access.seesNumbers ? "office" : "pm"} />
        {isAdminRole(me.role) && !v.readOnly && (
          <InviteClientButton projectId={id} projectName={project.name} reminder hasClient={memberProfiles.some((p) => p.role === "client")} />
        )}
      </div>
      <ProjectTabs projectId={id} fileCount={fileCount ?? 0} team={isTeamRole(me.role) && !v.clientOnly} office={access.seesNumbers && !v.readOnly} proposals={proposalCount} />
      {children}
    </div>
  );
}
