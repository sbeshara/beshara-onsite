import FilesView from "@/components/FilesView";
import { getMe } from "@/lib/auth";
import { projectViewer } from "@/lib/viewas";
import { chatClientsFor, clientSeesChat } from "@/lib/chat-clients";
import { signUrls } from "@/lib/storage";
import { createClient } from "@/lib/supabase/server";
import type { FileRow, Profile } from "@/lib/types";

type Row = FileRow & { messages: { chat_id: string } | null };

export default async function FilesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await getMe();
  const v = await projectViewer(id);
  const previewing = v.clientOnly;
  const supabase = await createClient();
  const [{ data: filesData }, { data: chatsData }, { data: peopleData }, only] = await Promise.all([
    supabase.from("files").select("*, messages(chat_id)").eq("project_id", id).order("created_at", { ascending: false }),
    supabase.from("chats").select("*").eq("project_id", id).order("position").order("created_at"),
    supabase.from("profiles").select("id, full_name, email"),
    chatClientsFor(supabase, id),
  ]);
  type ChatRow = { id: string; name: string; is_internal: boolean; source_id?: string | null };
  // In a client view, only the chats (and their files) that client is in.
  const chats = ((chatsData ?? []) as ChatRow[]).filter((c) => !previewing || clientSeesChat(c, only, v.clientId));
  const seen = new Set(chats.map((c) => c.id));
  const rows = (filesData ?? []) as Row[];
  const files = rows.filter((f) => !previewing || (!f.is_internal && (!f.messages || seen.has(f.messages.chat_id)))).map(({ messages, ...f }) => ({ ...f, chat_id: messages?.chat_id ?? null }));
  const names = Object.fromEntries(((peopleData ?? []) as Pick<Profile, "id" | "full_name" | "email">[]).map((p) => [p.id, p.full_name || p.email]));
  const urls = await signUrls(supabase, files.map((f) => f.storage_path));
  return (
    <FilesView
      projectId={id}
      files={files}
      chats={chats.map((c) => ({ id: c.id, name: c.name, is_internal: c.is_internal, imported: !!c.source_id }))}
      readOnly={v.readOnly}
      urls={urls}
      names={names}
      me={{ id: v.userId, role: v.role }}
    />
  );
}
