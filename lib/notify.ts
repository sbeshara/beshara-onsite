import "server-only";
import { plainText } from "./format";
import webpush from "web-push";
import { createAdminClient } from "./supabase/admin";

type Admin = ReturnType<typeof createAdminClient>;

const siteUrl = () => (process.env.NEXT_PUBLIC_SITE_URL ?? "https://onsite.besharabuilders.com").replace(/\/$/, "");

// Push keys are made once and kept in the database, so there's nothing to set up by hand.
export async function getVapidKeys(admin: Admin) {
  const { data } = await admin.from("app_settings").select("key, value").in("key", ["vapid_public", "vapid_private"]);
  const found = Object.fromEntries((data ?? []).map((r) => [r.key, r.value]));
  if (found.vapid_public && found.vapid_private) return { publicKey: found.vapid_public as string, privateKey: found.vapid_private as string };
  const keys = webpush.generateVAPIDKeys();
  await admin.from("app_settings").upsert(
    [
      { key: "vapid_public", value: keys.publicKey },
      { key: "vapid_private", value: keys.privateKey },
    ],
    { onConflict: "key", ignoreDuplicates: true },
  );
  // Another request may have won the race; use whatever is stored now.
  const { data: again } = await admin.from("app_settings").select("key, value").in("key", ["vapid_public", "vapid_private"]);
  const stored = Object.fromEntries((again ?? []).map((r) => [r.key, r.value]));
  return { publicKey: stored.vapid_public as string, privateKey: stored.vapid_private as string };
}

export type PushPayload = { title: string; body: string; url: string; tag: string };

export async function sendPushes(admin: Admin, messageId: string, payload: PushPayload) {
  const { data: targets } = await admin.rpc("message_push_targets", { p_message: messageId });
  if (!targets?.length) return 0;
  const { publicKey, privateKey } = await getVapidKeys(admin);
  webpush.setVapidDetails("mailto:onsite@besharabuilders.com", publicKey, privateKey);
  const body = JSON.stringify(payload);
  let sent = 0;
  await Promise.all(
    (targets as { subscription_id: string; endpoint: string; p256dh: string; auth: string }[]).map(async (t) => {
      try {
        await webpush.sendNotification({ endpoint: t.endpoint, keys: { p256dh: t.p256dh, auth: t.auth } }, body, { TTL: 60 * 60 * 24 });
        sent++;
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        // The browser or phone turned notifications off; forget this device.
        if (status === 404 || status === 410) await admin.from("push_subscriptions").delete().eq("id", t.subscription_id);
      }
    }),
  );
  return sent;
}

export async function sendEmail(to: string, subject: string, html: string) {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { ok: false, error: "RESEND_API_KEY is not set" };
  const res = await fetch(process.env.RESEND_API_URL ?? "https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: process.env.EMAIL_FROM ?? "Beshara Builders <onsite@besharabuilders.com>", to, subject, html }),
  });
  return res.ok ? { ok: true } : { ok: false, error: `${res.status} ${await res.text()}` };
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

// The branded email frame used for checklist reminders.
export function brandEmail(opts: { tag: string; heading: string; body: string; footer: string }) {
  const site = siteUrl();
  return `<!doctype html><html><body style="margin:0;padding:0;background:#F0F3F1;font-family:Helvetica,Arial,sans-serif;color:#151B18">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F0F3F1;padding:32px 12px"><tr><td align="center">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#FFFFFF;border:1px solid #DCE3DF;border-radius:14px;overflow:hidden">
    <tr><td style="background:#455C51;padding:22px 28px">
      <img src="${site}/logo.png" alt="Beshara Builders" height="44" style="display:inline-block;height:44px;vertical-align:middle;border:0">
      <span style="display:inline-block;vertical-align:middle;margin-left:14px;padding-left:14px;border-left:1px solid rgba(255,255,255,.3);color:#FFFFFF;font-family:Georgia,serif;font-style:italic;font-size:18px">${esc(opts.tag)}</span>
    </td></tr>
    <tr><td style="padding:26px 28px">
      <h1 style="margin:0 0 14px;font-family:Didot,'Bodoni 72',Georgia,serif;font-weight:normal;font-size:26px">${esc(opts.heading)}</h1>
      ${opts.body}
      <p style="margin:18px 0 0;font-size:12.5px;color:#5D6A64">${opts.footer}</p>
    </td></tr>
    <tr><td style="padding:16px 28px;border-top:1px solid #DCE3DF;font-size:12px;color:#5D6A64">Beshara Builders · Healthcare construction management · New Jersey</td></tr>
  </table></td></tr></table></body></html>`;
}

export { esc as escapeHtml };

const preview = (body: string, max: number) => {
  const t = plainText(body ?? "");
  return t ? (t.length > max ? t.slice(0, max) + "…" : t) : "Sent an attachment";
};

export type DigestRow = {
  user_id: string;
  email: string;
  full_name: string;
  project_id: string;
  project_name: string;
  chat_id: string;
  chat_name: string;
  author_name: string;
  body: string;
  created_at: string;
};

// One email listing someone's unread messages, grouped by project and chat.
export function digestEmail(rows: DigestRow[]) {
  const site = siteUrl();
  const first = (rows[0].full_name || "").split(" ")[0] || "there";
  const groups = new Map<string, DigestRow[]>();
  for (const r of rows) {
    const k = `${r.project_id}/${r.chat_id}`;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  const projects = new Set(rows.map((r) => r.project_name));
  const subject =
    rows.length === 1
      ? `New message from ${rows[0].author_name} · ${rows[0].project_name}`
      : `${rows.length} new messages${projects.size === 1 ? ` · ${rows[0].project_name}` : ""}`;
  const sections = [...groups.values()]
    .map((list) => {
      const r0 = list[0];
      const items = list
        .slice(-5)
        .map(
          (m) =>
            `<p style="margin:0 0 10px;font-size:14.5px;line-height:1.5"><b>${esc(m.author_name)}:</b> ${esc(preview(m.body, 280))}</p>`,
        )
        .join("");
      const more = list.length > 5 ? `<p style="margin:0 0 10px;font-size:13px;color:#5D6A64">and ${list.length - 5} more</p>` : "";
      return `<div style="border:1px solid #DCE3DF;border-radius:10px;padding:14px 16px;margin:0 0 12px">
        <p style="margin:0 0 8px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#9C7740;font-weight:bold">${esc(r0.project_name)} · ${esc(r0.chat_name)}</p>
        ${items}${more}
        <a href="${site}/projects/${r0.project_id}/chats/${r0.chat_id}" style="font-size:14px;font-weight:bold;color:#455C51">Open chat →</a>
      </div>`;
    })
    .join("");
  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#F0F3F1;font-family:Helvetica,Arial,sans-serif;color:#151B18">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F0F3F1;padding:32px 12px"><tr><td align="center">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#FFFFFF;border:1px solid #DCE3DF;border-radius:14px;overflow:hidden">
    <tr><td style="background:#455C51;padding:22px 28px">
      <img src="${site}/logo.png" alt="Beshara Builders" height="44" style="display:inline-block;height:44px;vertical-align:middle;border:0">
      <span style="display:inline-block;vertical-align:middle;margin-left:14px;padding-left:14px;border-left:1px solid rgba(255,255,255,.3);color:#FFFFFF;font-family:Georgia,serif;font-style:italic;font-size:18px">OnSite</span>
    </td></tr>
    <tr><td style="padding:26px 28px">
      <h1 style="margin:0 0 14px;font-family:Didot,'Bodoni 72',Georgia,serif;font-weight:normal;font-size:26px">Hi ${esc(first)}, you have ${rows.length === 1 ? "a new message" : `${rows.length} new messages`}</h1>
      ${sections}
      <p style="margin:18px 0 0;font-size:12.5px;color:#5D6A64">You're getting this because you haven't read these yet in Beshara OnSite. Turn off email notifications any time in <a href="${site}/account" style="color:#455C51">Your account</a>.</p>
    </td></tr>
    <tr><td style="padding:16px 28px;border-top:1px solid #DCE3DF;font-size:12px;color:#5D6A64">Beshara Builders · Healthcare construction management · New Jersey</td></tr>
  </table></td></tr></table></body></html>`;
  return { subject, html };
}
