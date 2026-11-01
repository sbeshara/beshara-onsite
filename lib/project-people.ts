import "server-only";
import { createAdminClient } from "./supabase/admin";
import { createClient } from "./supabase/server";
import type { Profile } from "./types";

export type ClientStatus = { signedIn: string | null; lastOpened: string | null };

// Everything the Team & Clients screen needs for one project: its team,
// its client contacts, and whether each client has accepted their invite and
// when they last opened the project's chats.
export async function loadProjectPeople(projectId: string) {
  const supabase = await createClient();
  const [{ data: project }, { data: members }, { data: staff }] = await Promise.all([
    supabase.from("projects").select("id, name, primary_client_id").eq("id", projectId).maybeSingle(),
    supabase.from("project_members").select("user_id, profiles(*)").eq("project_id", projectId),
    supabase.from("profiles").select("*").eq("role", "construction").order("full_name"),
  ]);
  if (!project) return null;
  const profiles = ((members ?? []) as unknown as { profiles: Profile | null }[]).map((m) => m.profiles).filter(Boolean) as Profile[];
  const clients = profiles.filter((p) => p.role === "client");
  const admin = createAdminClient();
  const [{ data: users }, { data: reads }] = await Promise.all([
    admin.auth.admin.listUsers({ perPage: 1000 }),
    clients.length
      ? admin.from("chat_reads").select("user_id, last_read_at, chats!inner(project_id)").eq("chats.project_id", projectId).in("user_id", clients.map((c) => c.id))
      : Promise.resolve({ data: [] as { user_id: string; last_read_at: string }[] }),
  ]);
  const status: Record<string, ClientStatus> = {};
  for (const c of clients) status[c.id] = { signedIn: users?.users.find((u) => u.id === c.id)?.last_sign_in_at ?? null, lastOpened: null };
  for (const r of (reads ?? []) as { user_id: string; last_read_at: string }[]) {
    const s = status[r.user_id];
    if (s && (!s.lastOpened || r.last_read_at > s.lastOpened)) s.lastOpened = r.last_read_at;
  }
  return {
    projectId,
    name: project.name as string,
    primaryClientId: project.primary_client_id as string | null,
    staff: (staff ?? []) as Profile[],
    assigned: profiles.filter((p) => p.role === "construction").map((p) => p.id),
    clients,
    status,
  };
}
