import { NextResponse, type NextRequest } from "next/server";
import { generateAll, isMondayMorning, lastFullWeek } from "@/lib/reports";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 300;

// Called hourly on Mondays by the database scheduler. Drafts last week's
// report for every linked project once it's 8 AM in New Jersey; projects
// that already have a draft are skipped, so repeat calls cost nothing.
export async function POST(request: NextRequest) {
  const admin = createAdminClient();
  const { data: secret } = await admin.from("app_settings").select("value").eq("key", "cron_secret").maybeSingle();
  if (!secret?.value || request.headers.get("x-onsite-secret") !== secret.value) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  if (!isMondayMorning() && request.nextUrl.searchParams.get("any_day") !== "1") {
    return NextResponse.json({ ok: true, skipped: "not Monday morning yet" });
  }
  const results = await generateAll(admin, lastFullWeek());
  return NextResponse.json({ ok: true, results });
}
