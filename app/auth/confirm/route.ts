import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Every emailed link (invite, sign-in link, password reset) lands here.
//
// Opening the link only shows a "Continue" button; the one-time link is used
// when the person clicks it. Many business email systems open every link in
// an email to scan it, which would otherwise use the link up before the
// client ever sees it ("expired or already used").

const safe = (next: string | null) => (next && next.startsWith("/") && !next.startsWith("//") ? next : "/");
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const COPY: Partial<Record<EmailOtpType, { title: string; button: string }>> = {
  invite: { title: "Welcome to Beshara OnSite", button: "Continue to Set Up My Account" },
  recovery: { title: "Set your password", button: "Continue to Set My Password" },
  magiclink: { title: "Sign in to Beshara OnSite", button: "Continue to Sign In" },
  email: { title: "Sign in to Beshara OnSite", button: "Continue to Sign In" },
  signup: { title: "Confirm your email", button: "Continue" },
  email_change: { title: "Confirm your new email", button: "Continue" },
};

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const code = searchParams.get("code");
  const next = safe(searchParams.get("next"));

  if (tokenHash && type) {
    const copy = COPY[type] ?? { title: "Beshara OnSite", button: "Continue" };
    const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${esc(copy.title)}</title>
<style>
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f3f1ec;font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#1f2a24;padding:16px;box-sizing:border-box}
.card{background:#fff;border:1px solid #e3e0d8;border-radius:16px;padding:32px 28px;max-width:420px;width:100%;box-sizing:border-box;text-align:center;box-shadow:0 10px 30px rgba(0,0,0,.06)}
.logo{display:block;margin:0 auto 18px;width:160px;height:56px;background:#41594b;-webkit-mask:url(/logo.png) center/contain no-repeat;mask:url(/logo.png) center/contain no-repeat}
h1{font-family:Georgia,serif;font-weight:500;font-size:26px;margin:0 0 8px}
p{color:#5f6b64;margin:0 0 22px}
button{width:100%;border:0;border-radius:10px;padding:14px 16px;font:inherit;font-weight:700;font-size:16px;background:#41594b;color:#fff;cursor:pointer}
button:hover{background:#344a3d}
</style></head><body>
<form class="card" method="post" action="/auth/confirm">
<span class="logo" role="img" aria-label="Beshara Builders"></span>
<h1>${esc(copy.title)}</h1>
<p>Click the button to keep going.</p>
<input type="hidden" name="token_hash" value="${esc(tokenHash)}">
<input type="hidden" name="type" value="${esc(type)}">
<input type="hidden" name="next" value="${esc(next)}">
<button type="submit">${esc(copy.button)}</button>
</form></body></html>`;
    return new NextResponse(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  }

  // Code-based links can only be used by the browser that asked for them.
  let ok = false;
  if (code) ok = !(await (await createClient()).auth.exchangeCodeForSession(code)).error;
  return NextResponse.redirect(ok ? `${origin}${next}` : `${origin}/login?error=link`);
}

export async function POST(request: NextRequest) {
  const { origin } = new URL(request.url);
  const form = await request.formData();
  const tokenHash = String(form.get("token_hash") ?? "");
  const type = String(form.get("type") ?? "") as EmailOtpType;
  const next = safe(String(form.get("next") ?? ""));
  const ok = !!tokenHash && !!type && !(await (await createClient()).auth.verifyOtp({ type, token_hash: tokenHash })).error;
  return NextResponse.redirect(ok ? `${origin}${next}` : `${origin}/login?error=link`, 303);
}
