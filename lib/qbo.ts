import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { createAdminClient } from "./supabase/admin";

// QuickBooks Online (Intuit's Accounting API). One connected company; tokens
// live in qbo_connection, which only the server can read.
//
// Settings (Vercel environment variables):
//   QBO_CLIENT_ID, QBO_CLIENT_SECRET   from the Intuit developer app
//   QBO_ENV                             "sandbox" while testing, "production" for real
//   QBO_WEBHOOK_VERIFIER                the app's webhook verifier token (for payment updates)

const AUTH_URL = "https://appcenter.intuit.com/connect/oauth2";
const TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
const apiBase = () => (process.env.QBO_ENV === "production" ? "https://quickbooks.api.intuit.com" : "https://sandbox-quickbooks.api.intuit.com");
const site = () => (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");
export const redirectUri = () => `${site()}/api/qbo/callback`;
export const qboConfigured = () => !!(process.env.QBO_CLIENT_ID && process.env.QBO_CLIENT_SECRET);

export class QboError extends Error {}

export function authorizeUrl(state: string) {
  const p = new URLSearchParams({
    client_id: process.env.QBO_CLIENT_ID ?? "",
    response_type: "code",
    scope: "com.intuit.quickbooks.accounting",
    redirect_uri: redirectUri(),
    state,
  });
  return `${AUTH_URL}?${p}`;
}

type Tokens = { access_token: string; refresh_token: string; expires_in: number; x_refresh_token_expires_in?: number };

async function tokenRequest(body: Record<string, string>): Promise<Tokens> {
  const basic = Buffer.from(`${process.env.QBO_CLIENT_ID}:${process.env.QBO_CLIENT_SECRET}`).toString("base64");
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams(body),
    cache: "no-store",
  });
  const text = await res.text();
  if (!res.ok) throw new QboError(`QuickBooks sign-in failed (${res.status}). Connect QuickBooks again from Invoicing.`);
  return JSON.parse(text) as Tokens;
}

const expiry = (t: Tokens) => ({
  access_token: t.access_token,
  refresh_token: t.refresh_token,
  access_expires_at: new Date(Date.now() + (t.expires_in - 120) * 1000).toISOString(),
  refresh_expires_at: t.x_refresh_token_expires_in ? new Date(Date.now() + t.x_refresh_token_expires_in * 1000).toISOString() : null,
});

// Finishes "Connect QuickBooks": swaps the code for tokens and saves them.
export async function connect(code: string, realmId: string, userId: string) {
  const t = await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: redirectUri() });
  const db = createAdminClient();
  const { error } = await db.from("qbo_connection").upsert({ id: true, realm_id: realmId, ...expiry(t), connected_by: userId, connected_at: new Date().toISOString(), item_id: null });
  if (error) throw new QboError("Couldn't save the QuickBooks connection.");
  try {
    const info = await api<{ CompanyInfo: { CompanyName: string } }>("GET", `/companyinfo/${realmId}`);
    await db.from("qbo_connection").update({ company_name: info.CompanyInfo.CompanyName }).eq("id", true);
  } catch {
    // The name is only for display.
  }
}

export async function connection() {
  const { data } = await createAdminClient().from("qbo_connection").select("realm_id, company_name, access_token, refresh_token, access_expires_at, item_id, last_payment_check, connected_at").maybeSingle();
  return data;
}

export async function disconnect() {
  const c = await connection();
  if (c) {
    const basic = Buffer.from(`${process.env.QBO_CLIENT_ID}:${process.env.QBO_CLIENT_SECRET}`).toString("base64");
    await fetch("https://developer.api.intuit.com/v2/oauth2/tokens/revoke", {
      method: "POST",
      headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ token: c.refresh_token }),
    }).catch(() => {});
  }
  await createAdminClient().from("qbo_connection").delete().eq("id", true);
}

async function accessToken() {
  const c = await connection();
  if (!c) throw new QboError("QuickBooks isn't connected. Connect it from Invoicing.");
  if (new Date(c.access_expires_at).getTime() > Date.now()) return { token: c.access_token, realm: c.realm_id };
  const t = await tokenRequest({ grant_type: "refresh_token", refresh_token: c.refresh_token });
  await createAdminClient().from("qbo_connection").update(expiry(t)).eq("id", true);
  return { token: t.access_token, realm: c.realm_id };
}

// A call to the Accounting API. `path` is after /v3/company/<realm>.
export async function api<T>(method: "GET" | "POST", path: string, body?: unknown, raw = false): Promise<T> {
  const { token, realm } = await accessToken();
  const sep = path.includes("?") ? "&" : "?";
  const res = await fetch(`${apiBase()}/v3/company/${realm}${path}${sep}minorversion=75`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      ...(body !== undefined ? { "Content-Type": "application/json" } : raw ? { "Content-Type": "application/octet-stream" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  const text = await res.text();
  if (!res.ok) {
    let detail = text.slice(0, 300);
    try {
      const j = JSON.parse(text);
      detail = j.Fault?.Error?.map((e: { Message: string; Detail?: string }) => e.Detail || e.Message).join("; ") ?? detail;
    } catch {}
    throw new QboError(`QuickBooks said: ${detail}`);
  }
  return JSON.parse(text) as T;
}

const q = (s: string) => s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
export async function query<T>(sql: string): Promise<T[]> {
  const r = await api<{ QueryResponse: Record<string, T[]> }>("GET", `/query?query=${encodeURIComponent(sql)}`);
  const key = Object.keys(r.QueryResponse).find((k) => Array.isArray(r.QueryResponse[k]));
  return key ? r.QueryResponse[key] : [];
}

// The QuickBooks customer for an OnSite customer: linked, found by name, or created.
export async function ensureCustomer(c: { id: string; name: string; email: string | null; qbo_customer_id: string | null; address: string | null }) {
  if (c.qbo_customer_id) return c.qbo_customer_id;
  const name = c.name.slice(0, 100);
  const found = await query<{ Id: string }>(`select Id from Customer where DisplayName = '${q(name)}'`);
  const id =
    found[0]?.Id ??
    (await api<{ Customer: { Id: string } }>("POST", "/customer", {
      DisplayName: name,
      ...(c.email ? { PrimaryEmailAddr: { Address: c.email } } : {}),
      ...(c.address ? { BillAddr: { Line1: c.address } } : {}),
    })).Customer.Id;
  await createAdminClient().from("customers").update({ qbo_customer_id: id }).eq("id", c.id);
  return id;
}

// The product/service OnSite bills under ("Construction Services"), found or created once.
export async function ensureItem() {
  const c = await connection();
  if (c?.item_id) return c.item_id;
  const NAME = "Construction Services";
  let id = (await query<{ Id: string }>(`select Id from Item where Name = '${NAME}'`))[0]?.Id;
  if (!id) {
    const income = (await query<{ Id: string }>(`select Id from Account where AccountType = 'Income' maxresults 1`))[0];
    if (!income) throw new QboError("QuickBooks has no income account to bill under.");
    id = (await api<{ Item: { Id: string } }>("POST", "/item", { Name: NAME, Type: "Service", IncomeAccountRef: { value: income.Id } })).Item.Id;
  }
  await createAdminClient().from("qbo_connection").update({ item_id: id }).eq("id", true);
  return id;
}

export type QboPayment = {
  Id: string;
  TxnDate: string;
  TotalAmt: number;
  PaymentRefNum?: string;
  PaymentMethodRef?: { name?: string; value: string };
  Line?: { Amount: number; LinkedTxn?: { TxnId: string; TxnType: string }[] }[];
};

// Payment method as people say it: "ACH", "Check #1042", "Credit card".
export function methodLabel(p: QboPayment) {
  const m = p.PaymentMethodRef?.name ?? "";
  return [m || "Payment", p.PaymentRefNum ? `#${p.PaymentRefNum}` : ""].filter(Boolean).join(" ");
}

// Intuit signs webhook bodies with the app's verifier token.
export function verifyWebhook(body: string, signature: string | null) {
  const key = process.env.QBO_WEBHOOK_VERIFIER;
  if (!key || !signature) return false;
  const want = createHmac("sha256", key).update(body).digest();
  const got = Buffer.from(signature, "base64");
  return got.length === want.length && timingSafeEqual(got, want);
}
