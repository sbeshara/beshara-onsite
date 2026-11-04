import { notFound, redirect } from "next/navigation";
import ChatPane from "@/components/ChatPane";
import { LockIcon, PeopleIcon } from "@/components/Icons";
import Thread from "@/components/Thread";
import { signUrls } from "@/lib/storage";
import { createClient } from "@/lib/supabase/server";
import type { Chat, Message, Profile } from "@/lib/types";
import { projectViewer } from "@/lib/viewas";

// The open chat: its name bar and the conversation.
export default async function ChatView({ projectId, chatId }: { projectId: string; chatId: string }) {
  const v = await projectViewer(projectId);
  const supabase = await createClient();
  const [{ data: chatData }, { data: msgData }, { data: peopleData }, { data: memberData }, { data: unreadData }] = await Promise.all([
    supabase.from("chats").select("*").eq("id", chatId).eq("project_id", projectId).maybeSingle(),
    supabase.from("messages").select("*, files(*)").eq("chat_id", chatId).order("created_at", { ascending: false }).limit(200),
    supabase.from("profiles").select("*"),
    supabase.from("project_members").select("user_id").eq("project_id", projectId),
    v.readOnly ? Promise.resolve({ data: [] }) : supabase.rpc("my_unread"),
  ]);
  const chat = chatData as Chat | null;
  // Client views never open an internal chat.
  if (chat && v.clientOnly && chat.is_internal) redirect(`/projects/${projectId}`);
  if (!chat) notFound();
  const messages = ((msgData ?? []) as Message[]).reverse();
  const people = Object.fromEntries(((peopleData ?? []) as Profile[]).map((p) => [p.id, p]));
  const clientNames = (memberData ?? []).map((m) => people[m.user_id]).filter((p) => p?.role === "client").map((p) => p.full_name || p.email);
  const urls = await signUrls(supabase, messages.flatMap((m) => (m.files ?? []).map((f) => f.storage_path)));
  const hadUnread = ((unreadData ?? []) as { chat_id: string }[]).some((u) => u.chat_id === chatId);

  return (
    <ChatPane
      key={chat.id}
      backHref={`/projects/${projectId}`}
      bar={
        <>
          <span className={`ic ${chat.is_internal ? "int" : ""}`} aria-hidden="true">
            {chat.is_internal ? <LockIcon /> : <PeopleIcon />}
          </span>
          <h2>{chat.name}</h2>
          {chat.source_id && <span className="tag-bc">Basecamp</span>}
          {v.role !== "client" && <span className="chat-vis">{chat.is_internal ? "Team only" : "The client sees this"}</span>}
        </>
      }
    >
      <Thread
        key={chat.id}
        chat={chat}
        initialMessages={messages}
        initialUrls={urls}
        people={people}
        me={{ id: v.userId, role: v.role }}
        clientNames={clientNames}
        readOnly={v.readOnly}
        hadUnread={hadUnread}
      />
    </ChatPane>
  );
}
