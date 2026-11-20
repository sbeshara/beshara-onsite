import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

// Which clients are in each of a project's chats. A chat missing from the
// result is for every client on the project.
export async function chatClientsFor(supabase: SupabaseClient, projectId: string): Promise<Record<string, string[]>> {
  const { data } = await supabase.from("chat_clients").select("chat_id, user_id, chats!inner(project_id)").eq("chats.project_id", projectId);
  const out: Record<string, string[]> = {};
  for (const r of (data ?? []) as { chat_id: string; user_id: string }[]) (out[r.chat_id] ??= []).push(r.user_id);
  return out;
}

// Whether a client (in a client preview or View As) would see this chat.
// The database enforces the same rule for clients themselves.
export const clientSeesChat = (chat: { id: string; is_internal: boolean }, only: Record<string, string[]>, clientId: string | null) =>
  !chat.is_internal && (!only[chat.id] || (!!clientId && only[chat.id].includes(clientId)));
