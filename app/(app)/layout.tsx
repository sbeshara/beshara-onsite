import Link from "next/link";
import ProjectSwitcher from "@/components/ProjectSwitcher";
import Rail from "@/components/Rail";
import { getMe } from "@/lib/auth";
import { ROLE_LABEL } from "@/lib/constants";
import { createClient } from "@/lib/supabase/server";
import { isAdminRole } from "@/lib/types";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const me = await getMe();
  const supabase = await createClient();
  const { data } = await supabase.from("projects").select("id, name, town, phase").order("created_at");
  const projects = data ?? [];
  const isClient = me.role === "client";
  const isAdmin = isAdminRole(me.role);

  return (
    <div className="app">
      <header className="top">
        <Link href="/" className="logo" aria-label="Beshara Builders, go to dashboard" />
        <span className="hub">OnSite</span>
        <div className="userchip">
          <b>{me.full_name || me.email}</b>
          <small>{ROLE_LABEL[me.role]}</small>
        </div>
        <form id="signout-form" action="/auth/signout" method="post">
          <button className="signout" type="submit">Sign out</button>
        </form>
        <ProjectSwitcher projects={projects} isClient={isClient} isAdmin={isAdmin} />
      </header>
      <div className="shell">
        <Rail projects={projects} isClient={isClient} isAdmin={isAdmin} />
        <main className="panel work">{children}</main>
      </div>
    </div>
  );
}
