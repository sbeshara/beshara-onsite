import "server-only";
import { cache } from "react";
import { createClient } from "./supabase/server";

export type UnreadRow = { chat_id: string; project_id: string; unread: number };

// Unread messages per chat for the signed-in person. Looked up once per page
// (the menu, the chat list and the open chat all share it).
export const myUnread = cache(async (): Promise<UnreadRow[]> => {
  const supabase = await createClient();
  const { data } = await supabase.rpc("my_unread");
  return ((data ?? []) as UnreadRow[]).map((r) => ({ ...r, unread: Number(r.unread) }));
});
