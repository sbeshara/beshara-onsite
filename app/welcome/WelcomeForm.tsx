"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Props = { name: string; email: string; projectName: string | null; reset: boolean };

export default function WelcomeForm({ name, email, projectName, reset }: Props) {
  const router = useRouter();
  const [fullName, setFullName] = useState(name);
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (pw.length < 8) return setError("Your password needs at least 8 characters.");
    if (pw !== pw2) return setError("The two passwords don't match. Type them again.");
    setBusy(true);
    setError("");
    const supabase = createClient();
    const { data, error } = await supabase.auth.updateUser({ password: pw, data: { full_name: fullName.trim() } });
    if (error || !data.user) {
      setBusy(false);
      return setError("We couldn't save your password. Try a different one.");
    }
    if (fullName.trim() && fullName.trim() !== name) {
      await supabase.from("profiles").update({ full_name: fullName.trim() }).eq("id", data.user.id);
    }
    router.replace("/");
    router.refresh();
  }

  return (
    <form className="auth-card" onSubmit={save}>
      <h1>{reset ? "Choose a New Password" : "Create Your Account"}</h1>
      <p className="sub">
        {reset ? "Pick a new password for Beshara OnSite." : projectName ? <>You&apos;ve been invited to <b>{projectName}</b>.</> : "Welcome to Beshara OnSite."}
      </p>
      {!reset && (
        <label className="field">
          Your Name
          <input id="full-name" required autoComplete="name" value={fullName} onChange={(e) => setFullName(e.target.value)} />
        </label>
      )}
      <label className="field">
        Email (This Is Your Username)
        <input id="email" type="email" value={email} readOnly />
      </label>
      <label className="field">
        {reset ? "New Password" : "Create a Password"}
        <input id="pw" type="password" required autoComplete="new-password" placeholder="At least 8 characters" value={pw} onChange={(e) => setPw(e.target.value)} />
      </label>
      <label className="field">
        Confirm Password
        <input id="pw2" type="password" required autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
      </label>
      {error && <p className="err" role="alert">{error}</p>}
      <button className="btn wide" type="submit" disabled={busy}>
        {busy ? "Saving…" : reset ? "Save Password" : "Create Account"}
      </button>
      <p className="fine">Use the same email and password on the website and in the Beshara OnSite app.</p>
    </form>
  );
}
