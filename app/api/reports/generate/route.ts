import { NextResponse, type NextRequest } from "next/server";
import { generateAll, reportWeek, scheduleSlot } from "@/lib/reports";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 300;

// Called hourly on Fridays and Saturdays by the database scheduler.
//   Friday from 3 PM: drafts each linked job once its Friday daily log is in.
//   Saturday 8 AM:    drafts the rest, refreshes untouched drafts still missing
//                     Looking Ahead, and emails their PMs.
// ?slot=friday|saturday runs that step now for the current report week.
export async function POST(request: NextRequest) {
  const admin = createAdminClient();
  const { data: secret } = await admin.from("app_settings").select("value").eq("key", "cron_secret").maybeSingle();
  if (!secret?.value || request.headers.get("x-onsite-secret") !== secret.value) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const forced = request.nextUrl.searchParams.get("slot");
  const slot = forced === "friday" || forced === "saturday" ? forced : scheduleSlot();
  const week = reportWeek();
  if (!slot || !week) return NextResponse.json({ ok: true, skipped: "outside the Friday-Saturday drafting hours" });
  const results =
    slot === "friday"
      ? await generateAll(admin, week, { waitForFriday: true })
      : await generateAll(admin, week, { refreshUntouched: true, notify: true });
  return NextResponse.json({ ok: true, slot, week, results });
}
