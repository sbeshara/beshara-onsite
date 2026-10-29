"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FILES_BUCKET, roleLabel } from "@/lib/constants";
import { dayLabel, guessFolder, isImage, shortDate, storagePath, timeLabel } from "@/lib/format";
import { createClient } from "@/lib/supabase/client";
import { isTeamRole, type Chat, type FileRow, type Message, type Profile, type Role } from "@/lib/types";
import Avatar, { CompanyAvatar } from "./Avatar";
import Composer from "./Composer";
import { DocIcon, LockIcon, PeopleIcon } from "./Icons";
import MessageBody from "./MessageBody";

type Props = {
  chat: Chat;
  initialMessages: Message[];
  initialUrls: Record<string, string>;
  people: Record<string, Profile>;
  me: { id: string; role: Role };
  clientNames: string[];
  readOnly?: boolean;
  hadUnread?: boolean;
};

const SELECT = "*, files(*)";

export default function Thread({ chat, initialMessages, initialUrls, people, me, clientNames, readOnly = false, hadUnread = false }: Props) {
  const router = useRouter();
  const supabase = useRef(createClient()).current;
  const [messages, setMessages] = useState(initialMessages);
  const [urls, setUrls] = useState(initialUrls);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const [dropped, setDropped] = useState<File[]>([]);
  const takeDropped = useCallback(() => setDropped([]), []);
  const listRef = useRef<HTMLDivElement>(null);

  const urlsRef = useRef(urls);
  urlsRef.current = urls;

  const sign = useCallback(
    async (files: FileRow[]) => {
      const missing = files.map((f) => f.storage_path).filter((p) => !urlsRef.current[p]);
      if (!missing.length) return;
      const { data } = await supabase.storage.from(FILES_BUCKET).createSignedUrls(missing, 3600);
      const add: Record<string, string> = {};
      for (const d of data ?? []) if (d.path && d.signedUrl) add[d.path] = d.signedUrl;
      setUrls((u) => ({ ...u, ...add }));
    },
    [supabase],
  );

  const reload = useCallback(async () => {
    const { data } = await supabase.from("messages").select(SELECT).eq("chat_id", chat.id).order("created_at", { ascending: false }).limit(200);
    if (!data) return;
    const next = (data as Message[]).reverse();
    setMessages(next);
    sign(next.flatMap((m) => m.files ?? []));
  }, [supabase, chat.id, sign]);

  // Live updates: new messages in this chat, and attachments landing a moment later.
  useEffect(() => {
    const channel = supabase
      .channel(`chat-${chat.id}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `chat_id=eq.${chat.id}` }, () => reload())
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "files", filter: `project_id=eq.${chat.project_id}` }, () => reload())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, chat.id, chat.project_id, reload]);

  // Opening a search result lands on that message; otherwise start at the newest.
  const jumpedRef = useRef(false);
  useEffect(() => {
    const target = !jumpedRef.current && window.location.hash.startsWith("#m-") ? document.getElementById(window.location.hash.slice(1)) : null;
    if (target) {
      jumpedRef.current = true;
      target.scrollIntoView({ block: "center" });
      target.classList.add("flash");
      return;
    }
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages.length]);

  // Opening a chat (or seeing a new message arrive in it) marks it read,
  // which clears its unread dot and keeps it out of the email digest.
  const refreshedRef = useRef(false);
  useEffect(() => {
    if (readOnly) return;
    supabase
      .from("chat_reads")
      .upsert({ user_id: me.id, chat_id: chat.id, last_read_at: new Date().toISOString() }, { onConflict: "user_id,chat_id" })
      .then(() => {
        if (hadUnread && !refreshedRef.current) {
          refreshedRef.current = true;
          router.refresh();
        }
      });
  }, [supabase, me.id, chat.id, messages.length, readOnly, hadUnread, router]);

  // Posts a message (HTML from the editor) and its attachments.
  async function send(body: string, files: File[]): Promise<boolean> {
    if (readOnly || (!body.trim() && !files.length)) return false;
    setError("");
    const { data: msg, error: msgErr } = await supabase
      .from("messages")
      .insert({ chat_id: chat.id, author_id: me.id, body: body.trim() })
      .select("id")
      .single();
    if (msgErr || !msg) {
      setError("Your message didn't send. Check your connection and try again.");
      return false;
    }
    let failed = 0;
    for (const file of files) {
      const path = storagePath(chat.project_id, file.name);
      const up = await supabase.storage.from(FILES_BUCKET).upload(path, file, { contentType: file.type || undefined });
      if (up.error) {
        failed++;
        continue;
      }
      const { error: rowErr } = await supabase.from("files").insert({
        project_id: chat.project_id,
        message_id: msg.id,
        name: file.name,
        storage_path: path,
        size_bytes: file.size,
        mime_type: file.type || null,
        folder: guessFolder(file.name),
        is_internal: chat.is_internal,
        uploaded_by: me.id,
      });
      if (rowErr) failed++;
    }
    if (failed) setError(`${failed} file${failed > 1 ? "s" : ""} didn't upload. Try attaching ${failed > 1 ? "them" : "it"} again.`);
    await reload();
    router.refresh(); // updates the chat list preview and the Files count
    return true;
  }

  const team = isTeamRole(me.role);
  const names = clientNames.join(" and ") || "The client";
  let lastDay = "";

  return (
    <div
      className={`thread ${team ? (chat.is_internal ? "team-int" : "team-cli") : ""} ${dragging ? "drop" : ""}`}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) {
          e.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        if (!readOnly) setDropped([...e.dataTransfer.files]);
      }}
    >
      <div className="msgs" ref={listRef} aria-live="polite">
        {/* Only the team sees which chats the client can read; clients never hear about Internal Only. */}
        {team &&
          (chat.is_internal ? (
            <div className="banner int"><LockIcon /><span><b>Internal Only.</b> {names} can&apos;t see this chat.</span></div>
          ) : (
            <div className="banner cli"><PeopleIcon /><span><b>Client-visible.</b> {names} {clientNames.length > 1 ? "see" : "sees"} everything posted here.</span></div>
          ))}
        {messages.length === 0 && <div className="empty">No messages yet. Post the first one below.</div>}
        {messages.map((m) => {
          const day = dayLabel(m.created_at);
          const showDay = day !== lastDay;
          lastDay = day;
          const company = m.posted_as === "company";
          const who = company ? null : (m.author_id && people[m.author_id]) || null;
          const name = company ? "Beshara Builders" : who ? who.full_name || who.email : m.imported_author || "Former member";
          return (
            <div key={m.id} style={{ display: "contents" }}>
              {showDay && <div className="day">{day}</div>}
              <div className="msg" id={`m-${m.id}`}>
                {company ? <CompanyAvatar /> : <Avatar id={m.author_id ?? name} name={name} url={who?.avatar_url} />}
                <div style={{ minWidth: 0 }}>
                  <div className="who">
                    <b>{name}</b>
                    {who && <span className="role">{roleLabel(who)}</span>}
                    {who && !isTeamRole(who.role) && <span className="tagc">Client</span>}
                    <time>{m.source_id ? `${shortDate(m.created_at)}, ${timeLabel(m.created_at)}` : timeLabel(m.created_at)}</time>
                    {m.source_id && <span className="tag-bc" title="Brought over from Basecamp">Basecamp</span>}
                  </div>
                  {m.body && <MessageBody text={m.body} />}
                  {(m.files ?? []).map((f) => {
                    const url = urls[f.storage_path];
                    return isImage(f.mime_type, f.name) && url ? (
                      <a key={f.id} className="phbtn" href={url} target="_blank" rel="noreferrer">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={url} alt={f.name} loading="lazy" />
                        <span>{f.name}</span>
                      </a>
                    ) : (
                      <a key={f.id} className="attach" href={url} target="_blank" rel="noreferrer">
                        <DocIcon />
                        {f.name}
                      </a>
                    );
                  })}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {readOnly ? (
        <div className="compose"><div className="hint">Client view: this is what the client sees. Exit client view to post.</div></div>
      ) : (
      <Composer
        internal={chat.is_internal}
        placeholder={chat.is_internal ? "Write to the team…" : "Write a message…"}
        error={error}
        hint={
          chat.is_internal
            ? "Internal chat. The client won't see this, or anything you attach."
            : me.role === "client"
              ? "Your Beshara team sees everything here."
              : "The client will see this message."
        }
        onPost={send}
        dropped={dropped}
        onDroppedTaken={takeDropped}
      />
      )}
    </div>
  );
}
