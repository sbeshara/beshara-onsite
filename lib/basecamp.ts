import "server-only";
import sanitizeHtml from "sanitize-html";
import { decodeEntities, plainText } from "./format";
import { SAFE_HTML } from "./html";
import { createAdminClient } from "./supabase/admin";

// Basecamp's API. Sign-in goes through 37signals Launchpad (OAuth); the token
// is kept server-side in basecamp_connection and never reaches the browser.
const LAUNCHPAD = (process.env.BASECAMP_LAUNCHPAD_URL ?? "https://launchpad.37signals.com").replace(/\/$/, "");
const API_ROOT = (process.env.BASECAMP_API_ROOT ?? "https://3.basecampapi.com").replace(/\/$/, "");
// Basecamp asks every integration to say who it is and how to reach them.
const USER_AGENT = "Beshara OnSite (https://onsite.besharabuilders.com)";

export class BasecampError extends Error {
  // A fatal error stops the whole import (e.g. Basecamp signed us out).
  constructor(message: string, readonly fatal = false) {
    super(message);
  }
}

export type Connection = { token: string; href: string; accountName: string | null; identityName: string | null };

const siteUrl = () => (process.env.NEXT_PUBLIC_SITE_URL ?? "https://onsite.besharabuilders.com").replace(/\/$/, "");
export const redirectUri = () => `${siteUrl()}/api/basecamp/callback`;
export const oauthReady = () => !!(process.env.BASECAMP_CLIENT_ID && process.env.BASECAMP_CLIENT_SECRET);

export function authorizeUrl(state: string) {
  const q = new URLSearchParams({ response_type: "code", type: "web_server", client_id: process.env.BASECAMP_CLIENT_ID!, redirect_uri: redirectUri(), state });
  return `${LAUNCHPAD}/authorization/new?${q}`;
}

type Tokens = { access_token: string; refresh_token?: string; expires_in?: number };

async function tokenRequest(params: Record<string, string>): Promise<Tokens> {
  const res = await fetch(`${LAUNCHPAD}/authorization/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": USER_AGENT },
    body: new URLSearchParams({ client_id: process.env.BASECAMP_CLIENT_ID!, client_secret: process.env.BASECAMP_CLIENT_SECRET!, ...params }),
    cache: "no-store",
  });
  const text = await res.text();
  if (!res.ok) throw new BasecampError(`Basecamp sign-in failed (${res.status}). Try connecting again.`);
  try {
    const t = JSON.parse(text) as Tokens;
    if (!t.access_token) throw new Error();
    return t;
  } catch {
    throw new BasecampError("Basecamp sign-in returned something unexpected. Try connecting again.");
  }
}

type Account = { href: string; name: string };

// The Basecamp (3/4/5) accounts this sign-in can reach. Someone invited into
// another company's Basecamp has more than one.
async function accountsFor(token: string) {
  const res = await fetch(`${API_ROOT}/authorization.json`, {
    headers: { Authorization: `Bearer ${token}`, "User-Agent": USER_AGENT },
    cache: "no-store",
  });
  if (!res.ok) throw new BasecampError(`Basecamp didn't accept the sign-in (${res.status}). Connect again.`);
  const auth = (await res.json()) as {
    identity?: { first_name?: string; last_name?: string };
    accounts?: { product: string; name: string; href: string }[];
  };
  const accounts: Account[] = (auth.accounts ?? []).filter((a) => a.product === "bc3").map((a) => ({ href: a.href.replace(/\/$/, ""), name: a.name }));
  if (!accounts.length) throw new BasecampError("That Basecamp sign-in doesn't have a Basecamp account on it.");
  const identity = [auth.identity?.first_name, auth.identity?.last_name].filter(Boolean).join(" ") || null;
  return { accounts, identity };
}

// Always Beshara Builders' own Basecamp, even when the person signing in was
// also invited into another company's (BASECAMP_ACCOUNT_ID overrides).
function pick(accounts: Account[]) {
  const id = process.env.BASECAMP_ACCOUNT_ID;
  return (id ? accounts.find((a) => a.href.endsWith(`/${id}`)) : undefined) ?? accounts.find((a) => /beshara/i.test(a.name)) ?? accounts[0];
}

async function save(t: Tokens, connectedBy: string | null) {
  const { accounts, identity } = await accountsFor(t.access_token);
  const acct = pick(accounts);
  const { error } = await createAdminClient()
    .from("basecamp_connection")
    .upsert({
      id: 1,
      access_token: t.access_token,
      refresh_token: t.refresh_token ?? null,
      expires_at: new Date(Date.now() + (t.expires_in ?? 14 * 86400) * 1000).toISOString(),
      account_href: acct.href,
      account_name: acct.name,
      identity_name: identity,
      ...(connectedBy ? { connected_by: connectedBy } : {}),
      updated_at: new Date().toISOString(),
    });
  if (error) throw new BasecampError(`Couldn't save the Basecamp connection: ${error.message}`);
}

export async function finishConnect(code: string, userId: string) {
  await save(await tokenRequest({ grant_type: "authorization_code", type: "web_server", redirect_uri: redirectUri(), code }), userId);
}

export async function disconnect() {
  await createAdminClient().from("basecamp_connection").delete().eq("id", 1);
}

let envAccount: Promise<{ href: string; accountName: string; identityName: string | null }> | null = null;

// The current connection, refreshing the token when it's within a day of expiring.
// BASECAMP_ACCESS_TOKEN in Vercel, if set, is used instead of signing in.
export async function connection(): Promise<Connection | null> {
  const envToken = process.env.BASECAMP_ACCESS_TOKEN;
  if (envToken) {
    envAccount ??= accountsFor(envToken)
      .then(({ accounts, identity }) => {
        const a = pick(accounts);
        return { href: a.href, accountName: a.name, identityName: identity };
      })
      .catch((e) => {
      envAccount = null;
      throw e;
    });
    const a = await envAccount;
    return { token: envToken, ...a };
  }
  const { data } = await createAdminClient().from("basecamp_connection").select("*").eq("id", 1).maybeSingle();
  if (!data) return null;
  if (data.refresh_token && data.expires_at && new Date(data.expires_at).getTime() < Date.now() + 86400_000 && oauthReady()) {
    try {
      const t = await tokenRequest({ grant_type: "refresh_token", type: "refresh", refresh_token: data.refresh_token });
      await save({ refresh_token: data.refresh_token, ...t }, null);
      return connection();
    } catch {
      if (new Date(data.expires_at).getTime() < Date.now()) return null;
    }
  }
  // A connection saved before OnSite always chose Beshara Builders may point
  // at another company's account; switch it over.
  if (!process.env.BASECAMP_ACCOUNT_ID && !/beshara/i.test(data.account_name ?? "")) {
    const acct = pick((await accountsFor(data.access_token)).accounts);
    if (acct.href !== data.account_href) {
      await createAdminClient().from("basecamp_connection").update({ account_href: acct.href, account_name: acct.name }).eq("id", 1);
      return { token: data.access_token, href: acct.href, accountName: acct.name, identityName: data.identity_name };
    }
  }
  return { token: data.access_token, href: data.account_href, accountName: data.account_name, identityName: data.identity_name };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// A request to the connected account, retrying when Basecamp asks us to slow
// down or has a hiccup. The token is only ever sent to Basecamp's own API.
export async function bcFetch(conn: Connection, pathOrUrl: string): Promise<Response> {
  const url = pathOrUrl.startsWith("http") ? pathOrUrl : `${conn.href}${pathOrUrl}`;
  const origin = new URL(url).origin;
  if (origin !== new URL(conn.href).origin && origin !== new URL(API_ROOT).origin) throw new BasecampError(`Refusing to send the Basecamp sign-in to ${origin}`);
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${conn.token}`, "User-Agent": USER_AGENT }, cache: "no-store" });
    if ((res.status === 429 || res.status >= 500) && attempt < 5) {
      const wait = Number(res.headers.get("retry-after")) || 2 ** attempt;
      await sleep(Math.min(wait, 30) * 1000);
      continue;
    }
    if (res.status === 401) throw new BasecampError("Basecamp signed us out. Connect Basecamp again, then run the import again.", true);
    if (!res.ok) {
      console.error(`Basecamp ${res.status} for ${new URL(url).pathname}`);
      throw new BasecampError(res.status === 404 ? "Basecamp says it's no longer there" : res.status === 403 ? "Basecamp says you don't have access" : `Basecamp error ${res.status}`);
    }
    return res;
  }
}

export async function bcGet<T>(conn: Connection, path: string): Promise<T> {
  return (await (await bcFetch(conn, path)).json()) as T;
}

// Every page of a list (Basecamp gives the next page in the Link header).
export async function bcAll<T>(conn: Connection, path: string): Promise<T[]> {
  const out: T[] = [];
  let next: string | null = path;
  while (next) {
    const res = await bcFetch(conn, next);
    out.push(...((await res.json()) as T[]));
    next = /<([^>]+)>;\s*rel="next"/.exec(res.headers.get("link") ?? "")?.[1] ?? null;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Basecamp records
// ---------------------------------------------------------------------------

export type BcPerson = { id: number; name: string; email_address?: string | null };
export type BcAttachment = { id: number; filename: string; content_type: string; byte_size: number; download_url: string };
export type BcProject = {
  id: number;
  name: string;
  status: string;
  description: string | null;
  purpose?: string;
  created_at: string;
  updated_at: string;
  app_url: string;
  dock: { id: number; name: string; enabled: boolean }[];
};
export type BcRecording = {
  id: number;
  title: string;
  visible_to_clients: boolean;
  created_at: string;
  creator: BcPerson;
  content?: string;
  content_attachments?: BcAttachment[];
  app_url?: string;
};
export type BcUpload = BcRecording & { filename: string; content_type: string; byte_size: number; download_url: string };

// ---------------------------------------------------------------------------
// Rich text: Basecamp's HTML, turned into what the OnSite editor writes.
// Files and images inside a post come over as attachments instead.
// ---------------------------------------------------------------------------

const attr = (tag: string, name: string) => new RegExp(`\\s${name}="([^"]*)"`, "i").exec(tag)?.[1] ?? "";
const text = (html: string) => decodeEntities(html.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function convertRichText(content: string | null | undefined): string {
  if (!content?.trim()) return "";
  const swapped = content.replace(/<bc-attachment\b([^>]*)>([\s\S]*?)<\/bc-attachment>/gi, (_m, attrs: string, inner: string) => {
    const tag = ` ${attrs}`;
    const caption = text(/<figcaption[^>]*>([\s\S]*?)<\/figcaption>/i.exec(inner)?.[1] ?? "") || attr(tag, "caption");
    if (/vnd\.basecamp\.mention/i.test(attr(tag, "content-type"))) return `<strong>@${esc(caption || "someone")}</strong>`;
    if (attr(tag, "filename")) return ""; // brought over as an attachment
    const href = attr(tag, "href") || attr(tag, "url");
    return href ? `<a href="${esc(href)}">${esc(caption || href)}</a>` : esc(caption);
  });
  const cleaned = sanitizeHtml(swapped, {
    ...SAFE_HTML,
    transformTags: {
      ...SAFE_HTML.transformTags,
      div: "p",
      h1: "h3",
      h2: "h3",
      h4: "h3",
      h5: "h3",
      h6: "h3",
      del: "s",
      strike: "s",
      pre: "p",
      b: "strong",
      i: "em",
    },
    nonTextTags: ["script", "style", "textarea", "option", "noscript", "figcaption"],
  })
    .replace(/^(\s|<br\s*\/?>|<p>\s*(<br\s*\/?>)?\s*<\/p>)+|(\s|<br\s*\/?>|<p>\s*(<br\s*\/?>)?\s*<\/p>)+$/g, "")
    .trim();
  return cleaned ? `<div>${cleaned}</div>` : "";
}

// Messages are capped at 10,000 characters; a longer Basecamp post is split
// into several plain-text messages instead.
export function splitBody(html: string, limit = 10000): string[] {
  if (html.length <= limit) return [html];
  const plain = plainText(html);
  const parts: string[] = [];
  let rest = plain;
  while (rest) {
    let cut = rest.length <= 8000 ? rest.length : rest.lastIndexOf("\n", 8000);
    if (cut < 4000) cut = 8000;
    parts.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\n+/, "");
  }
  return parts.map((p) => `<div>${p.split("\n").map(esc).join("<br>")}</div>`);
}

const EXT: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/heic": ".heic",
  "image/avif": ".avif",
  "application/pdf": ".pdf",
  "video/mp4": ".mp4",
  "video/quicktime": ".mov",
};

// Basecamp filenames sometimes have no extension; add one from the file type.
export function fileName(name: string, type: string) {
  const n = name.trim() || "file";
  return /\.[a-z0-9]{1,5}$/i.test(n) ? n : n + (EXT[type] ?? "");
}

export function documentFile(title: string, author: string, created: string, content: string | undefined) {
  const when = new Date(created).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "America/New_York" });
  const body = convertRichText(content);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>body{font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#1f2a24;max-width:760px;margin:40px auto;padding:0 16px}h1{font-size:26px;margin:0 0 4px}.by{color:#6b7280;margin:0 0 28px}table{border-collapse:collapse}td,th{border:1px solid #d1d5db;padding:6px 10px}</style>
</head><body><h1>${esc(title)}</h1><p class="by">${esc(author)} · ${esc(when)} · from Basecamp</p>${body}</body></html>`;
}
