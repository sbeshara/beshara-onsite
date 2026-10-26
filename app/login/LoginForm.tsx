"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LoginForm({ linkError }: { linkError: boolean }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(linkError ? "That link has expired or was already used. Sign in below, or ask Beshara Builders to resend your invite." : "");
  const [notice, setNotice] = useState("");

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const { error } = await createClient().auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) {
      setError("That email and password don't match. Try again, or use a sign-in link.");
      return;
    }
    router.replace("/");
    router.refresh();
  }

  async function sendLink(kind: "magic" | "reset") {
    setError("");
    setNotice("");
    const address = email.trim();
    if (!address) {
      setError("Type your email address first.");
      return;
    }
    const supabase = createClient();
    const origin = window.location.origin;
    const { error } =
      kind === "magic"
        ? await supabase.auth.signInWithOtp({
            email: address,
            options: { shouldCreateUser: false, emailRedirectTo: `${origin}/auth/confirm?next=/` },
          })
        : await supabase.auth.resetPasswordForEmail(address, { redirectTo: `${origin}/auth/confirm?next=/welcome?reset=1` });
    if (error) {
      setError("We couldn't send that email. Check the address, or ask Beshara Builders for an invite.");
      return;
    }
    setNotice(
      kind === "magic"
        ? `We sent a sign-in link to ${address}. Open it on this device.`
        : `We sent a link to ${address} to choose a new password.`,
    );
  }

  return (
    <form className="auth-card" onSubmit={signIn}>
      <h1>Sign in</h1>
      <p className="sub">Welcome back to Beshara OnSite.</p>
      <label className="field">
        Email
        <input id="email" type="email" required autoComplete="email" placeholder="you@yourpractice.com" value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      <label className="field">
        Password
        <input id="password" type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </label>
      <div className="lab-row">
        <button type="button" className="textbtn" onClick={() => sendLink("reset")}>
          Forgot password?
        </button>
      </div>
      {error && <p className="err" role="alert">{error}</p>}
      {notice && <p className="ok" role="status">{notice}</p>}
      <button className="btn wide" type="submit" disabled={busy}>
        {busy ? "Signing in…" : "Sign in"}
      </button>
      <div className="or"><span>or</span></div>
      <button type="button" className="btn ghost wide" onClick={() => sendLink("magic")}>
        Email me a sign-in link
      </button>
      <p className="fine">New here? Beshara Builders sends you an invite email to set up your account.</p>
    </form>
  );
}
