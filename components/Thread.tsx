"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FILES_BUCKET, roleLabel } from "@/lib/constants";
import { dayLabel, guessFolder, isImage, storagePath, timeLabel } from "@/lib/format";
import { createClient } from "@/lib/supabase/client";
import { isTeamRole, type Chat, type FileRow, type Message, type Profile, type Role } from "@/lib/types";
import Avatar, { CompanyAvatar } from "./Avatar";
import { ClipIcon, DocIcon, LockIcon, PeopleIcon, SendIcon } from "./Icons";

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

const SELECT = "id, chat_id, author_id, body, created_at, posted_as, files(*)";

export default function Thread({ chat, initialMessages, initialUrls, people, me, clientNames, readOnly = false, hadUnread = false }: Props) {
  const router = useRouter();
  const supabase = useRef(createClient()).current;
  const [messages, setMessages] = useState(initialMessages);
  const [urls, setUrls] = useState(initialUrls);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

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

  useEffect(() => {
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

  async function send(body: string, files: File[]) {
    if (readOnly || (!body.trim() && !files.length)) return;
    setSending(true);
    setError("");
    const { data: msg, error: msgErr } = await supabase
      .from("messages")
      .insert({ chat_id: chat.id, author_id: me.id, body: body.trim() })
      .select("id")
      .single();
    if (msgErr || !msg) {
      setSending(false);
      setError("Your message didn't send. Check your connection and try again.");
      return;
    }
    setText("");
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
    setSending(false);
    await reload();
    if (files.length) router.refresh(); // updates the Files count
    inputRef.current?.focus();
  }

  function onKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send(text, []);
    }
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
        send(text, [...e.dataTransfer.files]);
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
          const name = company ? "Beshara Builders" : who ? who.full_name || who.email : "Former member";
          return (
            <div key={m.id} style={{ display: "contents" }}>
              {showDay && <div className="day">{day}</div>}
              <div className="msg">
                {company ? <CompanyAvatar /> : <Avatar id={m.author_id ?? "x"} name={name} />}
                <div style={{ minWidth: 0 }}>
                  <div className="who">
                    <b>{name}</b>
                    {who && <span className="role">{roleLabel(who)}</span>}
                    {who && !isTeamRole(who.role) && <span className="tagc">Client</span>}
                    <time>{timeLabel(m.created_at)}</time>
                  </div>
                  {m.body && <div className="body">{m.body}</div>}
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
      <div className={`compose ${chat.is_internal ? "int" : ""}`}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send(text, []);
          }}
        >
          <label className="iconbtn" title="Attach photos or files" aria-label="Attach photos or files">
            <ClipIcon />
            <input
              type="file"
              multiple
              hidden
              onChange={(e) => {
                const files = [...(e.target.files ?? [])];
                e.target.value = "";
                send(text, files);
              }}
            />
          </label>
          <textarea
            ref={inputRef}
            rows={1}
            placeholder="Write a message…"
            aria-label="Message"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              e.target.style.height = "auto";
              e.target.style.height = Math.min(e.target.scrollHeight, 140) + "px";
            }}
            onKeyDown={onKey}
          />
          <button className="btn" type="submit" disabled={sending}>
            <SendIcon />
            <span>{sending ? "Sending…" : "Send"}</span>
          </button>
        </form>
        {error ? (
          <div className="err">{error}</div>
        ) : (
          <div className="hint">
            {chat.is_internal
              ? "Internal chat. The client won't see this, or anything you attach."
              : me.role === "client"
                ? "Your Beshara team sees everything here. Attach photos or drop files."
                : "The client will see this message. Attach photos or drop files here."}
          </div>
        )}
      </div>
      )}
    </div>
  );
}
