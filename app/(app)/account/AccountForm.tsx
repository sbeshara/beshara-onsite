"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Avatar from "@/components/Avatar";
import { createClient } from "@/lib/supabase/client";

// Square-crops and shrinks a photo to 320px so it loads quickly everywhere.
async function squarePhoto(file: File): Promise<Blob> {
  const img = await createImageBitmap(file);
  const side = Math.min(img.width, img.height);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 320;
  canvas.getContext("2d")!.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, 320, 320);
  return new Promise((ok, fail) => canvas.toBlob((b) => (b ? ok(b) : fail(new Error("photo"))), "image/jpeg", 0.88));
}

export default function AccountForm({ id, name, email, role, photo: initialPhoto }: { id: string; name: string; email: string; role: string; photo: string | null }) {
  const router = useRouter();
  const [fullName, setFullName] = useState(name);
  const [pw, setPw] = useState("");
  const [msg, setMsg] = useState<{ ok?: string; error?: string }>({});
  const [busy, setBusy] = useState(false);
  const [photo, setPhoto] = useState(initialPhoto);
  const [photoBusy, setPhotoBusy] = useState(false);

  async function changePhoto(file: File | null) {
    setMsg({});
    setPhotoBusy(true);
    const supabase = createClient();
    try {
      let url: string | null = null;
      if (file) {
        if (!file.type.startsWith("image/")) throw new Error("Pick a photo (JPG or PNG).");
        const path = `${id}/${Date.now()}.jpg`;
        const up = await supabase.storage.from("avatars").upload(path, await squarePhoto(file), { contentType: "image/jpeg" });
        if (up.error) throw new Error("Couldn't upload that photo. Try another one.");
        url = supabase.storage.from("avatars").getPublicUrl(path).data.publicUrl;
      }
      const { error } = await supabase.from("profiles").update({ avatar_url: url }).eq("id", id);
      if (error) throw new Error("Couldn't save your photo. Try again.");
      if (photo) {
        const old = photo.split("/avatars/")[1];
        if (old) await supabase.storage.from("avatars").remove([decodeURIComponent(old)]);
      }
      setPhoto(url);
      setMsg({ ok: url ? "Photo updated." : "Photo removed." });
      router.refresh();
    } catch (e) {
      setMsg({ error: (e as Error).message });
    }
    setPhotoBusy(false);
  }

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
      <div className="me-photo">
        <Avatar id={id} name={fullName || email} url={photo} />
        <div>
          <b>{fullName || email}</b>
          <div className="upl">{role} · {email}</div>
          <div className="me-photo-btns">
            <label className="linkbtn" style={{ cursor: "pointer" }}>
              {photoBusy ? "Uploading…" : photo ? "Change Photo" : "Upload Photo"}
              <input
                type="file"
                accept="image/*"
                hidden
                disabled={photoBusy}
                onChange={(e) => {
                  const f = e.target.files?.[0] ?? null;
                  e.target.value = "";
                  if (f) changePhoto(f);
                }}
              />
            </label>
            {photo && (
              <button type="button" className="linkbtn" disabled={photoBusy} onClick={() => changePhoto(null)}>
                Remove Photo
              </button>
            )}
          </div>
        </div>
      </div>
      <label className="field">
        Full Name
        <input id="full-name" required autoComplete="name" placeholder="e.g. Samuel Beshara" value={fullName} onChange={(e) => setFullName(e.target.value)} />
      </label>
      <label className="field">
        New Password (Optional)
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
