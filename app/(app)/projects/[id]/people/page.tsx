import { notFound, redirect } from "next/navigation";
import { getMe } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { isAdminRole, type Profile } from "@/lib/types";
import PeopleManager from "./PeopleManager";

export default async function PeoplePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await getMe();
  if (!isAdminRole(me.role)) redirect(`/projects/${id}`);
  const supabase = await createClient();
  const [{ data: project }, { data: members }, { data: staff }] = await Promise.all([
    supabase.from("projects").select("id, name, primary_client_id").eq("id", id).maybeSingle(),
    supabase.from("project_members").select("user_id, profiles(*)").eq("project_id", id),
    supabase.from("profiles").select("*").eq("role", "construction").order("full_name"),
  ]);
  if (!project) notFound();
  const profiles = ((members ?? []) as unknown as { profiles: Profile | null }[]).map((m) => m.profiles).filter(Boolean) as Profile[];
  return (
    <div className="page" style={{ borderTop: 0 }}>
      <PeopleManager
        projectId={id}
        primaryClientId={project.primary_client_id}
        staff={(staff ?? []) as Profile[]}
        assigned={profiles.filter((p) => p.role === "construction").map((p) => p.id)}
        clients={profiles.filter((p) => p.role === "client")}
      />
    </div>
  );
}
