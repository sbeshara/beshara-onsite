import { NextResponse, type NextRequest } from "next/server";
import { isWeekday, njNow, sendReminders } from "@/lib/checklist";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 120;

// Called hourly on weekdays by the database scheduler. Sends the morning
// checklist at 7 AM and the open-jobs reminder at 3 PM, New Jersey time.
// ?slot=morning|afternoon sends that round now (still once per person a day).
export async function POST(request: NextRequest) {
  const admin = createAdminClient();
  const { data: secret } = await admin.from("app_settings").select("value").eq("key", "cron_secret").maybeSingle();
  if (!secret?.value || request.headers.get("x-onsite-secret") !== secret.value) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const now = njNow();
  const forced = request.nextUrl.searchParams.get("slot");
  const slot = forced === "morning" || forced === "afternoon" ? forced : now.hour === 7 ? "morning" : now.hour === 15 ? "afternoon" : null;
  if (!slot || (!forced && !isWeekday(now.weekday))) return NextResponse.json({ ok: true, skipped: "not a reminder hour" });
  const sent = await sendReminders(admin, now.day, slot);
  return NextResponse.json({ ok: true, slot, sent });
}
