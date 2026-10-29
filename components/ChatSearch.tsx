"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { plainText, shortDate, timeLabel } from "@/lib/format";
import { createClient } from "@/lib/supabase/client";
import Avatar, { CompanyAvatar } from "./Avatar";
import { LockIcon, PeopleIcon } from "./Icons";

type Person = { name: string; url: string | null };
type Hit = {
  id: string;
  chat_id: string;
  author_id: string | null;
  body: string;
  created_at: string;
  posted_as: string | null;
  chats: { name: string; is_internal: boolean };
};

type Props = {
  projectId: string;
  chatId: string;
  // In client view, internal chats stay hidden from search too.
  clientView: boolean;
  people: Record<string, Person>;
  children: React.ReactNode;
};

// The words around the first match, with the match marked.
function snippet(text: string, q: string) {
  const at = text.toLowerCase().indexOf(q.toLowerCase());
  if (at < 0) return <>{text.slice(0, 160)}</>;
  const start = Math.max(0, at - 60);
  return (
    <>
      {start > 0 && "…"}
      {text.slice(start, at)}
      <mark>{text.slice(at, at + q.length)}</mark>
      {text.slice(at + q.length, at + q.length + 100)}
      {at + q.length + 100 < text.length && "…"}
    </>
  );
}

// Search every chat on the project ("cabinet" finds each message that
// mentions it); clicking a result opens that chat at the message.
export default function ChatSearch({ projectId, chatId, clientView, people, children }: Props) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<(Hit & { text: string })[] | null>(null);
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);
  const term = q.trim();

  useEffect(() => {
    if (term.length < 2) {
      setHits(null);
      return;
    }
    const n = ++seq.current;
    setBusy(true);
    const t = setTimeout(async () => {
      const like = `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      let query = createClient()
        .from("messages")
        .select("id, chat_id, author_id, body, created_at, posted_as, chats!inner(name, is_internal, project_id)")
        .eq("chats.project_id", projectId)
        .ilike("body", like)
        .order("created_at", { ascending: false })
        .limit(40);
      if (clientView) query = query.eq("chats.is_internal", false);
      const { data } = await query;
      if (n !== seq.current) return;
      // Matches inside formatting (e.g. a color code) don't count.
      const rows = ((data ?? []) as unknown as Hit[])
        .map((h) => ({ ...h, text: plainText(h.body) }))
        .filter((h) => h.text.toLowerCase().includes(term.toLowerCase()));
      setHits(rows);
      setBusy(false);
    }, 250);
    return () => clearTimeout(t);
  }, [term, projectId, clientView]);

  function open(h: Hit) {
    setQ("");
    const el = h.chat_id === chatId ? document.getElementById(`m-${h.id}`) : null;
    if (el) {
      el.scrollIntoView({ block: "center" });
      el.classList.remove("flash");
      void el.offsetWidth;
      el.classList.add("flash");
      history.replaceState(null, "", `#m-${h.id}`);
    } else {
      router.push(`/projects/${projectId}/chats/${h.chat_id}#m-${h.id}`);
    }
  }

  return (
    <>
      <div className="csearch">
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
          <circle cx="7" cy="7" r="4.5" />
          <path d="M10.5 10.5L14 14" />
        </svg>
        <input
          type="search"
          value={q}
          placeholder="Search Messages"
          aria-label="Search messages in this project"
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && setQ("")}
        />
      </div>
      {hits === null ? (
        children
      ) : (
        <div className="shits" aria-live="polite">
          <h3>{busy ? "Searching…" : hits.length ? `${hits.length === 40 ? "40+" : hits.length} ${hits.length === 1 ? "Message" : "Messages"} Found` : "No Messages Found"}</h3>
          {hits.map((h) => {
            const company = h.posted_as === "company";
            const who = h.author_id ? people[h.author_id] : undefined;
            const name = company ? "Beshara Builders" : who?.name ?? "Former member";
            return (
              <button key={h.id} type="button" className={`chan shit ${h.chats.is_internal ? "int" : ""}`} onClick={() => open(h)}>
                {company ? <CompanyAvatar /> : <Avatar id={h.author_id ?? "x"} name={name} url={who?.url} />}
                <span className="chan-main">
                  <span className="chan-top">
                    <span className="ic">{h.chats.is_internal ? <LockIcon /> : <PeopleIcon />}</span>
                    <span className="chan-name">{h.chats.name}</span>
                  </span>
                  <span className="chan-meta">
                    <b>{name}</b> · {shortDate(h.created_at)}, {timeLabel(h.created_at)}
                  </span>
                  <span className="chan-prev">{snippet(h.text, term)}</span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </>
  );
}
