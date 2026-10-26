"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Avatar from "@/components/Avatar";
import { createClient } from "@/lib/supabase/client";

export default function AccountForm({ id, name, email, role }: { id: string; name: string; email: string; role: string }) {
  const router = useRouter();
  const [fullName, setFullName] = useState(name);
  const [pw, setPw] = useState("");
  const [msg, setMsg] = useState<{ ok?: string; error?: string }>({});
  const [busy, setBusy] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = fullName.trim();
    if (!trimmed) return setMsg({ error: "Enter your name." });
    if (pw && pw.length < 8) return setMsg({ error: "A new password needs at least 8 characters." });
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.from("profiles").update({ full_name: trimmed }).eq("id", id);
    const auth = await supabase.auth.updateUser(pw ? { password: pw, data: { full_name: trimmed } } : { data: { full_name: trimmed } });
    setBusy(false);
    if (error || auth.error) return setMsg({ error: "Couldn't save your changes. Try again." });
    setPw("");
    setMsg({ ok: pw ? "Saved, including your new password." : "Saved." });
    router.refresh();
  }

  return (
    <form className="form" onSubmit={save}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <Avatar id={id} name={fullName || email} />
        <div>
          <b>{fullName || email}</b>
          <div className="upl">{role} · {email}</div>
        </div>
      </div>
      <label className="field">
        Full name
        <input id="full-name" required autoComplete="name" placeholder="e.g. Samuel Beshara" value={fullName} onChange={(e) => setFullName(e.target.value)} />
      </label>
      <label className="field">
        New password (optional)
        <input id="new-pw" type="password" autoComplete="new-password" placeholder="Leave blank to keep your current one" value={pw} onChange={(e) => setPw(e.target.value)} />
      </label>
      {msg.error && <p className="err">{msg.error}</p>}
      {msg.ok && <p className="ok">{msg.ok}</p>}
      <div className="actions" style={{ justifyContent: "flex-start" }}>
        <button className="btn" type="submit" disabled={busy}>{busy ? "Saving…" : "Save"}</button>
      </div>
    </form>
  );
}
