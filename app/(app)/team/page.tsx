import { redirect } from "next/navigation";
import { getMe } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { isAdminRole, type Profile } from "@/lib/types";
import TeamManager from "./TeamManager";

export const metadata = { title: "Team & Access · Beshara OnSite" };

export default async function TeamPage() {
  const me = await getMe();
  if (!isAdminRole(me.role)) redirect("/");
  const supabase = await createClient();
  const [{ data: people }, { data: members }, { data: projects }, { data: users }] = await Promise.all([
    supabase.from("profiles").select("*").neq("role", "client").order("full_name"),
    supabase.from("project_members").select("user_id, project_id"),
    supabase.from("projects").select("id, name, town").order("name"),
    createAdminClient().auth.admin.listUsers({ perPage: 1000 }),
  ]);
  const assigned: Record<string, string[]> = {};
  for (const m of members ?? []) (assigned[m.user_id] ??= []).push(m.project_id);
  // When each person last signed in; null means they haven't accepted their invite yet.
  const lastSignIn: Record<string, string | null> = {};
  for (const u of users?.users ?? []) lastSignIn[u.id] = u.last_sign_in_at ?? null;
  const team = ((people ?? []) as Profile[]).sort((a, b) => Number(!lastSignIn[a.id]) - Number(!lastSignIn[b.id]));

  return (
    <div className="page">
      <div className="page-h">
        <h1>Team &amp; Access</h1>
        <p>
          The Principal Contractor and Admins see every job. Construction Management only sees the jobs ticked under their name. Changes save as
          you tick.
        </p>
      </div>
      <TeamManager me={{ id: me.id, role: me.role }} people={team} projects={projects ?? []} assigned={assigned} lastSignIn={lastSignIn} />
    </div>
  );
}
