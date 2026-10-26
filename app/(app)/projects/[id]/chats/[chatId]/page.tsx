import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { LockIcon, PeopleIcon } from "@/components/Icons";
import NewChatButton from "@/components/NewChatButton";
import Thread from "@/components/Thread";
import { getMe } from "@/lib/auth";
import { getPreview } from "@/lib/preview";
import { signUrls } from "@/lib/storage";
import { createClient } from "@/lib/supabase/server";
import type { Chat, Message, Profile } from "@/lib/types";

export default async function ChatPage({ params }: { params: Promise<{ id: string; chatId: string }> }) {
  const { id, chatId } = await params;
  const me = await getMe();
  const previewing = (await getPreview()) === id;
  const supabase = await createClient();
  const [{ data: chatsData }, { data: msgData }, { data: peopleData }, { data: memberData }] = await Promise.all([
    supabase.from("chats").select("*").eq("project_id", id).order("position").order("created_at"),
    supabase.from("messages").select("id, chat_id, author_id, body, created_at, files(*)").eq("chat_id", chatId).order("created_at", { ascending: false }).limit(200),
    supabase.from("profiles").select("id, full_name, email, role, title"),
    supabase.from("project_members").select("user_id").eq("project_id", id),
  ]);
  const chats = ((chatsData ?? []) as Chat[]).filter((c) => !previewing || !c.is_internal);
  const chat = chats.find((c) => c.id === chatId);
  if (!chat) {
    if (previewing && chats.length) redirect(`/projects/${id}/chats/${chats[0].id}`);
    notFound();
  }
  const messages = ((msgData ?? []) as Message[]).reverse();
  const people = Object.fromEntries(((peopleData ?? []) as Profile[]).map((p) => [p.id, p]));
  const clientNames = (memberData ?? []).map((m) => people[m.user_id]).filter((p) => p?.role === "client").map((p) => p.full_name || p.email);
  const urls = await signUrls(supabase, messages.flatMap((m) => (m.files ?? []).map((f) => f.storage_path)));
  const teamView = me.role !== "client" && !previewing;
  const shared = chats.filter((c) => !c.is_internal);
  const internal = chats.filter((c) => c.is_internal);

  const chatLink = (c: Chat) => (
    <Link key={c.id} className={`chan ${c.is_internal ? "int" : ""}`} href={`/projects/${id}/chats/${c.id}`} aria-current={c.id === chatId ? "page" : undefined}>
      <span className="ic">{c.is_internal ? <LockIcon /> : <PeopleIcon />}</span>
      {c.name}
    </Link>
  );

  return (
    <div className="chat">
      <div className="chans" aria-label="Chats">
        {!previewing && <NewChatButton projectId={id} myId={me.id} isClient={me.role === "client"} />}
        {teamView && <h3>With client</h3>}
        {shared.map(chatLink)}
        {internal.length > 0 && (
          <>
            <h3>Internal</h3>
            {internal.map(chatLink)}
          </>
        )}
      </div>
      <Thread
        key={chat.id}
        chat={chat}
        initialMessages={messages}
        initialUrls={urls}
        people={people}
        me={{ id: me.id, role: previewing ? "client" : me.role }}
        clientNames={clientNames}
        readOnly={previewing}
      />
    </div>
  );
}
