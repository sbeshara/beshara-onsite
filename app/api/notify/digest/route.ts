import { NextResponse } from "next/server";
import { digestEmail, sendEmail, type DigestRow } from "@/lib/notify";
import { createAdminClient } from "@/lib/supabase/admin";

// How long a message can sit unread before it goes in an email.
const GRACE_MINUTES = Number(process.env.NOTIFY_GRACE_MINUTES ?? 5);

// Run every 5 minutes by the database scheduler. Emails anyone with messages
// they haven't read for 5+ minutes, then remembers where it left off, so
// calling it again never repeats an email.
export async function POST() {
  const admin = createAdminClient();
  const until = new Date(Date.now() - GRACE_MINUTES * 60_000).toISOString();
  const { data, error } = await admin.rpc("pending_email_digest", { p_until: until });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  const byUser = new Map<string, DigestRow[]>();
  for (const r of (data ?? []) as DigestRow[]) byUser.set(r.user_id, [...(byUser.get(r.user_id) ?? []), r]);

  let sent = 0;
  const failed: string[] = [];
  for (const [userId, rows] of byUser) {
    const { subject, html } = digestEmail(rows);
    const res = await sendEmail(rows[0].email, subject, html);
    if (res.ok) {
      sent++;
      await admin.from("notify_state").upsert({ user_id: userId, email_cursor: until }, { onConflict: "user_id" });
    } else {
      failed.push(`${rows[0].email}: ${res.error}`);
    }
  }
  return NextResponse.json({ ok: failed.length === 0, sent, failed });
}

export const GET = POST;
