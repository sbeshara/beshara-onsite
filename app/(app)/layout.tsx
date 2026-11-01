import Link from "next/link";
import ProjectSwitcher from "@/components/ProjectSwitcher";
import Rail from "@/components/Rail";
import ServiceWorker from "@/components/ServiceWorker";
import { HQ_URL } from "@/lib/apps";
import { getMe } from "@/lib/auth";
import { ROLE_LABEL } from "@/lib/constants";
import { getPreview } from "@/lib/preview";
import { getViewAs } from "@/lib/viewas";
import { allowed } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import { isAdminRole } from "@/lib/types";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const me = await getMe();
  const preview = await getPreview();
  const viewAs = preview ? null : await getViewAs();
  const supabase = await createClient();
  const { data } = await supabase.from("projects").select("id, name, town, phase, primary_client_id").order("created_at");
  const all = data ?? [];
  const { data: unreadRows } = preview || viewAs ? { data: [] } : await supabase.rpc("my_unread");
  const unreadProjects = [...new Set(((unreadRows ?? []) as { project_id: string }[]).map((r) => r.project_id))];

  // While previewing as a client, the menus show exactly what that client would see.
  const previewProject = preview ? all.find((p) => p.id === preview) : undefined;
  let previewClient = "the client";
  if (previewProject?.primary_client_id) {
    const { data: c } = await supabase.from("profiles").select("full_name, email").eq("id", previewProject.primary_client_id).maybeSingle();
    if (c) previewClient = c.full_name || c.email;
  }
  // While viewing as someone, the menus show exactly their projects and tools.
  const projects = previewProject ? [previewProject] : viewAs?.projectIds ? all.filter((p) => viewAs.projectIds!.includes(p.id)) : all;
  const isClient = me.role === "client" || !!previewProject || !!viewAs?.isClient;
  const isAdmin = isAdminRole(me.role) && !previewProject && (!viewAs || isAdminRole(viewAs.profile.role));
  const canCreate = !previewProject && !viewAs && (await allowed(me.role, "pm_create_projects"));

  return (
    <div className="app">
      <ServiceWorker />
      <header className="top">
        {me.role === "client" ? (
          <Link href="/" className="logo" aria-label="Beshara Builders, go to dashboard" />
        ) : (
          <a href={HQ_URL} className="logo" aria-label="Beshara HQ" />
        )}
        <span className="hub">OnSite</span>
        <Link href="/account" className="userchip" title="Your account">
          <b>{me.full_name || me.email}</b>
          <small>{ROLE_LABEL[me.role]}</small>
        </Link>
        <form id="signout-form" action="/auth/signout" method="post">
          <button className="signout" type="submit">Sign Out</button>
        </form>
        <ProjectSwitcher projects={projects} isClient={isClient} isAdmin={isAdmin} canCreate={canCreate} />
        {previewProject && (
          <div className="previewbar" role="status">
            <span>
              Viewing <b>{previewProject.name}</b> as <b>{previewClient}</b> sees it. You can look around, but you can&apos;t post or change anything here.
            </span>
            <a className="linkbtn" href="/preview/exit">Exit Client View</a>
          </div>
        )}
        {viewAs && (
          <div className="previewbar" role="status">
            <span>
              Viewing as <b>{viewAs.profile.full_name || viewAs.profile.email}</b> ({ROLE_LABEL[viewAs.profile.role]}): what they see, read-only. You
              can&apos;t post or change anything as them.
            </span>
            <a className="linkbtn" href="/view-as/exit">Exit View As</a>
          </div>
        )}
      </header>
      <div className="shell">
        <Rail
          projects={projects}
          isClient={isClient}
          isAdmin={isAdmin}
          canCreate={canCreate}
          unread={unreadProjects}
        />
        <main className="panel work">{children}</main>
      </div>
    </div>
  );
}
