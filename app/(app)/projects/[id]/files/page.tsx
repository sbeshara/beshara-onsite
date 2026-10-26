import FilesView from "@/components/FilesView";
import { getMe } from "@/lib/auth";
import { signUrls } from "@/lib/storage";
import { createClient } from "@/lib/supabase/server";
import type { FileRow, Profile } from "@/lib/types";

type Row = FileRow & { messages: { chat_id: string } | null };

export default async function FilesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await getMe();
  const supabase = await createClient();
  const [{ data: filesData }, { data: chatsData }, { data: peopleData }] = await Promise.all([
    supabase.from("files").select("*, messages(chat_id)").eq("project_id", id).order("created_at", { ascending: false }),
    supabase.from("chats").select("id, name").eq("project_id", id).order("position").order("created_at"),
    supabase.from("profiles").select("id, full_name, email"),
  ]);
  const rows = (filesData ?? []) as Row[];
  const files = rows.map(({ messages, ...f }) => ({ ...f, chat_id: messages?.chat_id ?? null }));
  const names = Object.fromEntries(((peopleData ?? []) as Pick<Profile, "id" | "full_name" | "email">[]).map((p) => [p.id, p.full_name || p.email]));
  const urls = await signUrls(supabase, files.map((f) => f.storage_path));
  return (
    <FilesView
      key={files.length}
      projectId={id}
      files={files}
      chats={(chatsData ?? []) as { id: string; name: string }[]}
      urls={urls}
      names={names}
      me={{ id: me.id, role: me.role }}
    />
  );
}
