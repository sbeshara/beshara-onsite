"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createChat } from "@/app/actions";
import ClientPicker, { type ClientChoice } from "@/components/ClientPicker";

type Client = { id: string; name: string };

export default function NewChatButton({ projectId, isClient, clients }: { projectId: string; isClient: boolean; clients: Client[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [pick, setPick] = useState<ClientChoice>({ everyone: true, ids: clients.map((c) => c.id) });

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy(true);
    setError("");
    const r = await createChat(projectId, trimmed, isClient || pick.everyone ? null : pick.ids);
    setBusy(false);
    if (r.error || !r.chatId) {
      setError(r.error ?? "Couldn't create the chat. Try again.");
      return;
    }
    setOpen(false);
    setName("");
    setPick({ everyone: true, ids: clients.map((c) => c.id) });
    router.push(`/projects/${projectId}/chats/${r.chatId}`);
    router.refresh();
  }

  return (
    <>
      <button type="button" className="chan newc" onClick={() => setOpen(true)}>+ New Chat</button>
      {open && (
        <div className="modal-bg" onClick={(e) => e.target === e.currentTarget && setOpen(false)}>
          <form className="modal" role="dialog" aria-modal="true" aria-labelledby="newchat-h" onSubmit={create} onKeyDown={(e) => e.key === "Escape" && setOpen(false)}>
            <h2 id="newchat-h">New Chat</h2>
            <p className="sub">Give one topic its own conversation, like millwork or the punch list.</p>
            <label className="field">
              Chat Name
              <input id="chat-name" autoFocus maxLength={60} required placeholder="e.g. Millwork" autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            {isClient ? (
              <p className="sub" style={{ margin: 0 }}>Everyone on this project, including your Beshara team, will see this chat.</p>
            ) : (
              <>
                <ClientPicker clients={clients} value={pick} onChange={setPick} />
                <p className="sub" style={{ margin: 0 }}>Your Beshara team always sees it. Team-only conversations go in <b>Internal Only</b>.</p>
              </>
            )}
            {error && <p className="err" role="alert">{error}</p>}
            <div className="actions">
              <button type="button" className="btn ghost" onClick={() => setOpen(false)}>Cancel</button>
              <button className="btn" type="submit" disabled={busy || (!isClient && !pick.everyone && !pick.ids.length)}>{busy ? "Creating…" : "Create Chat"}</button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
