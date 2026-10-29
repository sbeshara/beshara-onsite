import Link from "next/link";
import Avatar, { CompanyAvatar } from "@/components/Avatar";
import ChatSearch from "@/components/ChatSearch";
import { notFound, redirect } from "next/navigation";
import { LockIcon, PeopleIcon } from "@/components/Icons";
import NewChatButton from "@/components/NewChatButton";
import Thread from "@/components/Thread";
import { getMe } from "@/lib/auth";
import { plainText, shortDate, timeLabel } from "@/lib/format";
import { getPreview } from "@/lib/preview";
import { signUrls } from "@/lib/storage";
import { createClient } from "@/lib/supabase/server";
import type { Chat, Message, Profile } from "@/lib/types";

export default async function ChatPage({ params }: { params: Promise<{ id: string; chatId: string }> }) {
  const { id, chatId } = await params;
  const me = await getMe();
  const previewing = (await getPreview()) === id;
  const supabase = await createClient();
  const [{ data: chatsData }, { data: msgData }, { data: peopleData }, { data: memberData }, { data: unreadData }] = await Promise.all([
    supabase.from("chats").select("*").eq("project_id", id).order("position").order("created_at"),
    supabase.from("messages").select("*, files(*)").eq("chat_id", chatId).order("created_at", { ascending: false }).limit(200),
    supabase.from("profiles").select("*"),
    supabase.from("project_members").select("user_id").eq("project_id", id),
    supabase.rpc("my_unread"),
  ]);
  // The newest message in each chat, for the previews in the chat list.
  const { data: latestData } = await supabase.rpc("latest_messages");
  type Latest = { chat_id: string; project_id: string; message_id: string; author_id: string | null; body: string; created_at: string; imported_author?: string | null };
  const latestRows = ((latestData ?? []) as Latest[]).filter((l) => l.project_id === id);
  const { data: postedAs } = latestRows.length
    ? await supabase.from("messages").select("id, posted_as").in("id", latestRows.map((l) => l.message_id))
    : { data: [] as { id: string; posted_as: string | null }[] };
  const company = new Set((postedAs ?? []).filter((m) => m.posted_as === "company").map((m) => m.id));
  const latest = Object.fromEntries(latestRows.map((l) => [l.chat_id, { ...l, company: company.has(l.message_id) }]));
  const unread = Object.fromEntries(((unreadData ?? []) as { chat_id: string; unread: number }[]).map((u) => [u.chat_id, Number(u.unread)]));
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
  const everyday = chats.filter((c) => !c.source_id);
  const shared = everyday.filter((c) => !c.is_internal);
  const internal = everyday.filter((c) => c.is_internal);
  // Posts brought over from Basecamp, most recent activity first.
  const imported = chats
    .filter((c) => c.source_id)
    .sort((a, b) => (latest[b.id]?.created_at ?? "").localeCompare(latest[a.id]?.created_at ?? ""));

  const chatLink = (c: Chat) => {
    const l = latest[c.id];
    const who = l && !l.company && l.author_id ? people[l.author_id] : undefined;
    const author = l ? (l.company ? "Beshara Builders" : who?.full_name || who?.email || l.imported_author || "Former member") : "";
    const text = l ? plainText(l.body).replace(/\s+/g, " ") || "Sent an attachment" : "No messages yet";
    const count = c.id !== chatId ? unread[c.id] ?? 0 : 0;
    return (
      <Link
        key={c.id}
        className={`chan ${c.is_internal ? "int" : ""} ${count ? "unread" : ""}`}
        href={`/projects/${id}/chats/${c.id}`}
        aria-current={c.id === chatId ? "page" : undefined}
      >
        {!l ? (
          <span className="av av-none">{c.is_internal ? <LockIcon /> : <PeopleIcon />}</span>
        ) : l.company ? (
          <CompanyAvatar />
        ) : (
          <Avatar id={l.author_id ?? author} name={author} url={who?.avatar_url} />
        )}
        <span className="chan-main">
          <span className="chan-top">
            <span className="ic" title={c.is_internal ? "Internal Only" : "The client sees this"}>{c.is_internal ? <LockIcon /> : <PeopleIcon />}</span>
            <span className="chan-name">{c.name}</span>
            {count ? <span className="ucount" aria-label={`${count} new`}>{count > 99 ? "99+" : count}</span> : null}
          </span>
          <span className="chan-prev">
            {l && (
              <>
                <b>{author}</b> · <time className="chan-when">{shortDate(l.created_at)}, {timeLabel(l.created_at)}</time> ·{" "}
              </>
            )}
            {text}
          </span>
        </span>
      </Link>
    );
  };
  const searchPeople = Object.fromEntries(Object.values(people).map((p) => [p.id, { name: p.full_name || p.email, url: p.avatar_url ?? null }]));

  return (
    <div className="chat">
      <div className="chans" aria-label="Chats">
        <ChatSearch projectId={id} chatId={chatId} clientView={previewing} people={searchPeople}>
          {!previewing && <NewChatButton projectId={id} myId={me.id} isClient={me.role === "client"} />}
          {teamView && <h3>With Client</h3>}
          {shared.map(chatLink)}
          {internal.length > 0 && (
            <>
              <h3>Internal</h3>
              {internal.map(chatLink)}
            </>
          )}
          {imported.length > 0 && (
            <>
              <h3>From Basecamp · {imported.length}</h3>
              {imported.map(chatLink)}
            </>
          )}
        </ChatSearch>
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
        hadUnread={!!unread[chatId]}
      />
    </div>
  );
}
