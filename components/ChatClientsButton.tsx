"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { setChatClients } from "@/app/actions";
import ClientPicker, { type ClientChoice } from "@/components/ClientPicker";

// In a chat's name bar (team only): which clients are in it, and a way to change that.
export default function ChatClientsButton({ chatId, label, clients, only }: { chatId: string; label: string; clients: { id: string; name: string }[]; only: string[] | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pick, setPick] = useState<ClientChoice>({ everyone: !only, ids: only ?? clients.map((c) => c.id) });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const r = await setChatClients(chatId, pick.everyone ? null : pick.ids);
    setBusy(false);
    if (r.error) return setError(r.error);
    setOpen(false);
    router.refresh();
  }

  return (
    <>
      <button type="button" className="chat-vis chat-vis-btn" onClick={() => setOpen(true)} title="Choose which clients are in this chat">
        {label}
      </button>
      {open && (
        <div className="modal-bg" onClick={(e) => e.target === e.currentTarget && setOpen(false)}>
          <form className="modal" role="dialog" aria-modal="true" aria-labelledby="cclients-h" onSubmit={save} onKeyDown={(e) => e.key === "Escape" && setOpen(false)}>
            <h2 id="cclients-h">Clients in This Chat</h2>
            <ClientPicker clients={clients} value={pick} onChange={setPick} />
            <p className="sub" style={{ margin: 0 }}>Your Beshara team always sees it. Anyone you take out stops seeing the chat and its files right away.</p>
            {error && <p className="err" role="alert">{error}</p>}
            <div className="actions">
              <button type="button" className="btn ghost" onClick={() => setOpen(false)}>Cancel</button>
              <button className="btn" type="submit" disabled={busy || (!pick.everyone && !pick.ids.length)}>{busy ? "Saving…" : "Save"}</button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
