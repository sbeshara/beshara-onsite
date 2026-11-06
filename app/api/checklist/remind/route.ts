import { NextResponse, type NextRequest } from "next/server";
import { isWeekday, njNow, sendReminders } from "@/lib/checklist";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 120;

// Called hourly on weekdays by the database scheduler. Sends the end-of-day
// reminder at 5 PM New Jersey time, only for jobs still missing today's log
// (there's no morning reminder: a log is due by the end of the day).
// ?slot=afternoon sends it now (still once per person a day).
export async function POST(request: NextRequest) {
  const admin = createAdminClient();
  const { data: secret } = await admin.from("app_settings").select("value").eq("key", "cron_secret").maybeSingle();
  if (!secret?.value || request.headers.get("x-onsite-secret") !== secret.value) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const now = njNow();
  const forced = request.nextUrl.searchParams.get("slot");
  const slot = forced === "afternoon" ? forced : now.hour === 17 ? "afternoon" : null;
  if (!slot || (!forced && !isWeekday(now.weekday))) return NextResponse.json({ ok: true, skipped: "not a reminder hour" });
  const sent = await sendReminders(admin, now.day, slot);
  return NextResponse.json({ ok: true, slot, sent });
}
