import { notFound, redirect } from "next/navigation";
import ChatPane from "@/components/ChatPane";
import { LockIcon, PeopleIcon } from "@/components/Icons";
import Thread from "@/components/Thread";
import { signUrls } from "@/lib/storage";
import { createClient } from "@/lib/supabase/server";
import { myUnread } from "@/lib/unread";
import type { Chat, Message, Profile } from "@/lib/types";
import { projectViewer } from "@/lib/viewas";
import { clientSeesChat } from "@/lib/chat-clients";
import ChatClientsButton from "@/components/ChatClientsButton";

// The open chat: its name bar and the conversation.
export default async function ChatView({ projectId, chatId }: { projectId: string; chatId: string }) {
  const v = await projectViewer(projectId);
  const supabase = await createClient();
  const [{ data: chatData }, { data: msgData }, { data: peopleData }, { data: memberData }, { data: unreadData }, { data: onlyData }] = await Promise.all([
    supabase.from("chats").select("*, projects(name)").eq("id", chatId).eq("project_id", projectId).maybeSingle(),
    supabase.from("messages").select("*, files(*)").eq("chat_id", chatId).order("created_at", { ascending: false }).limit(200),
    supabase.from("profiles").select("*"),
    supabase.from("project_members").select("user_id").eq("project_id", projectId),
    v.readOnly ? Promise.resolve({ data: [] }) : myUnread().then((data) => ({ data })),
    supabase.from("chat_clients").select("user_id").eq("chat_id", chatId),
  ]);
  const chat = chatData as (Chat & { projects?: { name: string } | null }) | null;
  // Only these clients are in the chat (null: every client on the project).
  const only = onlyData?.length ? onlyData.map((r) => r.user_id as string) : null;
  // Client views never open an internal chat, or one they're not in.
  if (chat && v.clientOnly && !clientSeesChat(chat, only ? { [chat.id]: only } : {}, v.clientId)) redirect(`/projects/${projectId}`);
  if (!chat) notFound();
  const messages = ((msgData ?? []) as Message[]).reverse();
  const people = Object.fromEntries(((peopleData ?? []) as Profile[]).map((p) => [p.id, p]));
  const clients = (memberData ?? [])
    .map((m) => people[m.user_id])
    .filter((p): p is Profile => !!p && p.role === "client")
    .map((p) => ({ id: p.id, name: p.full_name || p.email }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const inChat = only ? clients.filter((c) => only.includes(c.id)) : clients;
  const clientNames = inChat.map((c) => c.name);
  const firstNames = inChat.map((c) => c.name.replace(/^(Dr\.?|Mr\.?|Mrs\.?|Ms\.?)\s+/, "").split(" ")[0]);
  const visLabel = chat.is_internal
    ? "Team only"
    : only
      ? `Only ${firstNames.length > 2 ? `${firstNames.slice(0, 2).join(", ")} +${firstNames.length - 2}` : firstNames.join(" & ")} ${firstNames.length === 1 ? "sees" : "see"} this`
      : clients.length
        ? "All clients see this"
        : "The client sees this";
  const urls = await signUrls(supabase, messages.flatMap((m) => (m.files ?? []).map((f) => f.storage_path)));
  const hadUnread = ((unreadData ?? []) as { chat_id: string }[]).some((u) => u.chat_id === chatId);

  return (
    <ChatPane
      key={chat.id}
      backHref={`/projects/${projectId}?list=1`}
      bar={
        <>
          <span className={`ic ${chat.is_internal ? "int" : ""}`} aria-hidden="true">
            {chat.is_internal ? <LockIcon /> : <PeopleIcon />}
          </span>
          <div className="chat-title">
            <h2>{chat.name}</h2>
            {/* On a phone the project header is hidden in a chat, so its name shows here. */}
            {chat.projects?.name && <span className="chat-proj">{chat.projects.name}</span>}
          </div>
          {chat.source_id && <span className="tag-bc">Basecamp</span>}
          {v.role !== "client" &&
            (chat.is_internal || v.readOnly ? (
              <span className="chat-vis">{visLabel}</span>
            ) : (
              <ChatClientsButton key={only?.join() ?? "all"} chatId={chat.id} label={visLabel} clients={clients} only={only} />
            ))}
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
