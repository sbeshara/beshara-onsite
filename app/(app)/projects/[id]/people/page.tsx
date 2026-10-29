import { notFound, redirect } from "next/navigation";
import { getMe } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
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
  const clients = profiles.filter((p) => p.role === "client");
  // Whether each client has accepted their invite (signed in at least once),
  // and when they last opened one of this project's chats.
  const admin = createAdminClient();
  const [{ data: users }, { data: reads }] = await Promise.all([
    admin.auth.admin.listUsers({ perPage: 1000 }),
    clients.length
      ? admin.from("chat_reads").select("user_id, last_read_at, chats!inner(project_id)").eq("chats.project_id", id).in("user_id", clients.map((c) => c.id))
      : Promise.resolve({ data: [] as { user_id: string; last_read_at: string }[] }),
  ]);
  const status: Record<string, { signedIn: string | null; lastOpened: string | null }> = {};
  for (const c of clients) status[c.id] = { signedIn: users?.users.find((u) => u.id === c.id)?.last_sign_in_at ?? null, lastOpened: null };
  for (const r of (reads ?? []) as { user_id: string; last_read_at: string }[]) {
    const s = status[r.user_id];
    if (s && (!s.lastOpened || r.last_read_at > s.lastOpened)) s.lastOpened = r.last_read_at;
  }
  return (
    <div className="page" style={{ borderTop: 0 }}>
      <PeopleManager
        projectId={id}
        primaryClientId={project.primary_client_id}
        staff={(staff ?? []) as Profile[]}
        assigned={profiles.filter((p) => p.role === "construction").map((p) => p.id)}
        clients={clients}
        status={status}
      />
    </div>
  );
}
