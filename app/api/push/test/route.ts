import { NextResponse } from "next/server";
import webpush from "web-push";
import { getMe } from "@/lib/auth";
import { getVapidKeys } from "@/lib/notify";
import { createAdminClient } from "@/lib/supabase/admin";

// Sends a test notification to the signed-in person's own devices.
export async function POST() {
  const me = await getMe();
  const admin = createAdminClient();
  const { data: subs } = await admin.from("push_subscriptions").select("id, endpoint, p256dh, auth").eq("user_id", me.id);
  if (!subs?.length) return NextResponse.json({ sent: 0 });
  const { publicKey, privateKey } = await getVapidKeys(admin);
  webpush.setVapidDetails("mailto:onsite@besharabuilders.com", publicKey, privateKey);
  const body = JSON.stringify({ title: "Beshara OnSite", body: "Notifications are working on this device.", url: "/account", tag: "test" });
  let sent = 0;
  for (const s of subs) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body);
      sent++;
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) await admin.from("push_subscriptions").delete().eq("id", s.id);
    }
  }
  return NextResponse.json({ sent });
}
