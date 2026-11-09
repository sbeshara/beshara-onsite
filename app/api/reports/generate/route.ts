import { NextResponse, type NextRequest } from "next/server";
import { generateAll, reportWeek, scheduleSlot } from "@/lib/reports";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 300;

// Called hourly by the database scheduler. While reports are open (Friday
// 10 AM to Monday noon) every run drafts jobs not drafted yet and redrafts
// drafts nobody has edited whenever that week's daily logs (Monday through
// Sunday) have changed. Saturday 8 AM also emails PMs whose report is still
// missing Looking Ahead.
// ?slot=refresh|saturday runs that step now (friday is the same as refresh).
export async function POST(request: NextRequest) {
  const admin = createAdminClient();
  const { data: secret } = await admin.from("app_settings").select("value").eq("key", "cron_secret").maybeSingle();
  if (!secret?.value || request.headers.get("x-onsite-secret") !== secret.value) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const forced = request.nextUrl.searchParams.get("slot");
  const slot = forced === "saturday" ? "saturday" : forced === "friday" || forced === "refresh" ? "refresh" : scheduleSlot();
  const week = reportWeek();
  if (!slot || !week) return NextResponse.json({ ok: true, skipped: "reports are closed (open Friday 10 AM to Monday noon)" });
  const results = await generateAll(admin, week, { refreshUntouched: true, notify: slot === "saturday" });
  return NextResponse.json({ ok: true, slot, week, results });
}
