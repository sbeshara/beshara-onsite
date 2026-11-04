import Link from "next/link";
import Avatar, { CompanyAvatar } from "@/components/Avatar";
import ChatSearch from "@/components/ChatSearch";
import { LockIcon, PeopleIcon } from "@/components/Icons";
import NewChatButton from "@/components/NewChatButton";
import { getMe } from "@/lib/auth";
import { plainText, shortDate, timeLabel } from "@/lib/format";
import { getPermissions } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import type { Chat, Profile } from "@/lib/types";
import { projectViewer } from "@/lib/viewas";

// A project's chats, beside the open chat: search, + New Chat, one list sorted
// by the newest message (Basecamp posts included), Internal Only pinned at the
// bottom.
export async function loadChats(projectId: string) {
  const v = await projectViewer(projectId);
  const supabase = await createClient();
  const [{ data: chatsData }, { data: peopleData }, { data: unreadData }, { data: latestData }] = await Promise.all([
    supabase.from("chats").select("*").eq("project_id", projectId).order("position").order("created_at"),
    supabase.from("profiles").select("*"),
    v.readOnly ? Promise.resolve({ data: [] }) : supabase.rpc("my_unread"),
    supabase.rpc("latest_messages"),
  ]);
  type Latest = { chat_id: string; project_id: string; message_id: string; author_id: string | null; body: string; created_at: string; imported_author?: string | null };
  const latestRows = ((latestData ?? []) as Latest[]).filter((l) => l.project_id === projectId);
  const { data: postedAs } = latestRows.length
    ? await supabase.from("messages").select("id, posted_as").in("id", latestRows.map((l) => l.message_id))
    : { data: [] as { id: string; posted_as: string | null }[] };
  const company = new Set((postedAs ?? []).filter((m) => m.posted_as === "company").map((m) => m.id));
  const latest = Object.fromEntries(latestRows.map((l) => [l.chat_id, { ...l, company: company.has(l.message_id) }]));
  const unread = Object.fromEntries(((unreadData ?? []) as { chat_id: string; unread: number }[]).map((u) => [u.chat_id, Number(u.unread)]));
  const chats = ((chatsData ?? []) as Chat[]).filter((c) => !v.clientOnly || !c.is_internal);
  const people = Object.fromEntries(((peopleData ?? []) as Profile[]).map((p) => [p.id, p]));
  const pinned = chats.find((c) => c.is_internal && !c.source_id);
  const listed = chats
    .filter((c) => c !== pinned)
    .sort((a, b) => (latest[b.id]?.created_at ?? "").localeCompare(latest[a.id]?.created_at ?? "") || a.position - b.position);
  // The chat a project opens on: the newest one (Internal Only if it's the only one).
  const first = listed[0] ?? (v.role !== "client" ? pinned : undefined);
  return { v, latest, unread, people, pinned, listed, first };
}

export default async function ChatList({ projectId, activeId, data }: { projectId: string; activeId?: string; data?: Awaited<ReturnType<typeof loadChats>> }) {
  const me = await getMe();
  const { v, latest, unread, people, pinned, listed } = data ?? (await loadChats(projectId));
  const canStart = !v.readOnly && (me.role !== "client" || (await getPermissions()).clients_start_chats);

  const chatLink = (c: Chat) => {
    const l = latest[c.id];
    const who = l && !l.company && l.author_id ? people[l.author_id] : undefined;
    const author = l ? (l.company ? "Beshara Builders" : who?.full_name || who?.email || l.imported_author || "Former member") : "";
    const text = l ? plainText(l.body).replace(/\s+/g, " ") || "Sent an attachment" : "No messages yet";
    const count = c.id !== activeId ? unread[c.id] ?? 0 : 0;
    return (
      <Link
        key={c.id}
        className={`chan ${c.is_internal ? "int" : ""} ${count ? "unread" : ""}`}
        href={`/projects/${projectId}/chats/${c.id}`}
        aria-current={c.id === activeId ? "page" : undefined}
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
            {c.source_id && <span className="tag-bc">Basecamp</span>}
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
    <div className="chans" aria-label="Chats">
      <ChatSearch projectId={projectId} chatId={activeId ?? ""} clientView={v.clientOnly} people={searchPeople}>
        {canStart && <NewChatButton projectId={projectId} myId={me.id} isClient={me.role === "client"} />}
        <div className="chans-list">
          {listed.map(chatLink)}
          {!listed.length && <div className="empty">No chats yet.</div>}
        </div>
        {pinned && v.role !== "client" && <div className="chans-pin">{chatLink(pinned)}</div>}
      </ChatSearch>
    </div>
  );
}
