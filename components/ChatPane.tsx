"use client";

import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useState } from "react";

// One open chat, beside the chat list. Clicking into the writing box (or Full
// Screen) blows the chat up to fill the window; Exit Full Screen, Esc or
// posting brings the list back.
type Pane = { expanded: boolean; expand: () => void; collapse: () => void };
const PaneContext = createContext<Pane>({ expanded: false, expand: () => {}, collapse: () => {} });
export const useChatPane = () => useContext(PaneContext);

export default function ChatPane({ backHref, bar, children }: { backHref: string; bar: React.ReactNode; children: React.ReactNode }) {
  const [expanded, setExpanded] = useState(false);
  const expand = useCallback(() => setExpanded(true), []);
  const collapse = useCallback(() => setExpanded(false), []);

  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExpanded(false);
    };
    document.addEventListener("keydown", onKey);
    document.body.classList.add("chat-expanded");
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.classList.remove("chat-expanded");
    };
  }, [expanded]);

  return (
    <PaneContext.Provider value={{ expanded, expand, collapse }}>
      <section className={`chat-pane ${expanded ? "expanded" : ""}`} aria-label="Chat">
        <div className="chat-bar">
          <Link className="btn ghost chat-back" href={backHref}>
            ← All Chats
          </Link>
          {bar}
          <button
            type="button"
            className={`btn ${expanded ? "" : "ghost"} chat-expand`}
            onClick={() => setExpanded((x) => !x)}
            title={expanded ? "Back to the chat list (Esc)" : "Show this chat on the whole screen"}
          >
            {expanded ? "Exit Full Screen" : "Full Screen"}
          </button>
        </div>
        {children}
      </section>
    </PaneContext.Provider>
  );
}
