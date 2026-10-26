import Link from "next/link";
import { notFound } from "next/navigation";
import Avatar from "@/components/Avatar";
import PhaseControl from "@/components/PhaseControl";
import ProjectTabs from "@/components/ProjectTabs";
import { getMe } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { isAdminRole, isTeamRole, type Profile } from "@/lib/types";

export default async function ProjectLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await getMe();
  const supabase = await createClient();
  const [{ data: project }, { data: members }, { data: owners }, { count: fileCount }] = await Promise.all([
    supabase.from("projects").select("id, name, town, scope, phase").eq("id", id).maybeSingle(),
    supabase.from("project_members").select("user_id, profiles(id, full_name, email, role, title)").eq("project_id", id),
    supabase.from("profiles").select("id, full_name, email, role, title").eq("role", "owner"),
    supabase.from("files").select("id", { count: "exact", head: true }).eq("project_id", id),
  ]);
  if (!project) notFound();
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
              {everyone.map((p) => <Avatar key={p.id} id={p.id} name={p.full_name || p.email} />)}
            </div>
            <span className="sub">{everyone.length} people</span>
            {isAdminRole(me.role) && <Link className="linkbtn" href={`/projects/${id}/people`}>Team &amp; clients</Link>}
          </div>
        </div>
        <PhaseControl projectId={id} phase={project.phase} canEdit={isTeamRole(me.role)} />
      </div>
      <ProjectTabs projectId={id} fileCount={fileCount ?? 0} />
      {children}
    </div>
  );
}
