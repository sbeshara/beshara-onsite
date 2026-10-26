"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function NewChatButton({ projectId, myId, isClient }: { projectId: string; myId: string; isClient: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy(true);
    setError("");
    const { data, error } = await createClient()
      .from("chats")
      .insert({ project_id: projectId, name: trimmed, is_internal: false, created_by: myId, position: 50 })
      .select("id")
      .single();
    setBusy(false);
    if (error || !data) {
      setError(error?.code === "23505" ? `There's already a chat called "${trimmed}". Pick a different name.` : "Couldn't create the chat. Try again.");
      return;
    }
    setOpen(false);
    setName("");
    router.push(`/projects/${projectId}/chats/${data.id}`);
    router.refresh();
  }

  return (
    <>
      <button type="button" className="chan newc" onClick={() => setOpen(true)}>+ New chat</button>
      {open && (
        <div className="modal-bg" onClick={(e) => e.target === e.currentTarget && setOpen(false)}>
          <form className="modal" role="dialog" aria-modal="true" aria-labelledby="newchat-h" onSubmit={create} onKeyDown={(e) => e.key === "Escape" && setOpen(false)}>
            <h2 id="newchat-h">New chat</h2>
            <p className="sub">Give one topic its own conversation, like millwork or the punch list.</p>
            <label className="field">
              Chat name
              <input id="chat-name" autoFocus maxLength={60} required placeholder="e.g. Millwork" autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <p className="sub" style={{ margin: 0 }}>
              {isClient ? (
                "Everyone on this project, including your Beshara team, will see this chat."
              ) : (
                <>Everyone on this project, including the client, will see this chat. Team-only conversations go in <b>Internal Only</b>.</>
              )}
            </p>
            {error && <p className="err" role="alert">{error}</p>}
            <div className="actions">
              <button type="button" className="btn ghost" onClick={() => setOpen(false)}>Cancel</button>
              <button className="btn" type="submit" disabled={busy}>{busy ? "Creating…" : "Create chat"}</button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
