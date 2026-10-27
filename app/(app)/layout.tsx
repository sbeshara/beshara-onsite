import Link from "next/link";
import ProjectSwitcher from "@/components/ProjectSwitcher";
import Rail from "@/components/Rail";
import ServiceWorker from "@/components/ServiceWorker";
import { HQ_URL } from "@/lib/apps";
import { getMe } from "@/lib/auth";
import { ROLE_LABEL } from "@/lib/constants";
import { getPreview } from "@/lib/preview";
import { createClient } from "@/lib/supabase/server";
import { isAdminRole } from "@/lib/types";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const me = await getMe();
  const preview = await getPreview();
  const supabase = await createClient();
  const { data } = await supabase.from("projects").select("id, name, town, phase, primary_client_id").order("created_at");
  const all = data ?? [];
  const { data: unreadRows } = preview ? { data: [] } : await supabase.rpc("my_unread");
  const unreadProjects = [...new Set(((unreadRows ?? []) as { project_id: string }[]).map((r) => r.project_id))];

  // While previewing as a client, the menus show exactly what that client would see.
  const previewProject = preview ? all.find((p) => p.id === preview) : undefined;
  let previewClient = "the client";
  if (previewProject?.primary_client_id) {
    const { data: c } = await supabase.from("profiles").select("full_name, email").eq("id", previewProject.primary_client_id).maybeSingle();
    if (c) previewClient = c.full_name || c.email;
  }
  const projects = previewProject ? [previewProject] : all;
  const isClient = me.role === "client" || !!previewProject;
  const isAdmin = isAdminRole(me.role) && !previewProject;

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
        <ProjectSwitcher projects={projects} isClient={isClient} isAdmin={isAdmin} />
        {previewProject && (
          <div className="previewbar" role="status">
            <span>
              Viewing <b>{previewProject.name}</b> as <b>{previewClient}</b> sees it. You can look around, but you can&apos;t post or change anything here.
            </span>
            <a className="linkbtn" href="/preview/exit">Exit Client View</a>
          </div>
        )}
      </header>
      <div className="shell">
        <Rail projects={projects} isClient={isClient} isAdmin={isAdmin} unread={unreadProjects} />
        <main className="panel work">{children}</main>
      </div>
    </div>
  );
}
