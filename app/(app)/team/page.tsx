import { redirect } from "next/navigation";
import { getMe } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { isAdminRole, type Profile } from "@/lib/types";
import TeamManager from "./TeamManager";

export const metadata = { title: "Team · Beshara OnSite" };

export default async function TeamPage() {
  const me = await getMe();
  if (!isAdminRole(me.role)) redirect("/");
  const supabase = await createClient();
  const [{ data: people }, { data: members }] = await Promise.all([
    supabase.from("profiles").select("id, full_name, email, role, title").neq("role", "client").order("full_name"),
    supabase.from("project_members").select("user_id"),
  ]);
  const counts: Record<string, number> = {};
  for (const m of members ?? []) counts[m.user_id] = (counts[m.user_id] ?? 0) + 1;
  return (
    <div className="page">
      <div className="page-h">
        <h1>Team</h1>
        <p>The Principal Contractor and Admin see every project and can create projects, add clients and assign the team. Construction Management sees only the jobs they&apos;re assigned to.</p>
      </div>
      <TeamManager me={{ id: me.id, role: me.role }} people={(people ?? []) as Profile[]} counts={counts} />
    </div>
  );
}
