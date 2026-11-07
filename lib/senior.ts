import "server-only";
import { createAdminClient } from "./supabase/admin";

// A Senior PM is a Construction Management person who also sees the team
// check-in board on HQ (every PM's daily logs), to check the others filled
// theirs in. Everything else stays as for any PM: the jobs they're assigned
// to, and the daily logs they're responsible for. Kept in app_settings.
export const SENIOR_KEY = (userId: string) => `senior_pm:${userId}`;

export async function seniorPmIds(): Promise<string[]> {
  const { data } = await createAdminClient().from("app_settings").select("key").like("key", "senior_pm:%");
  return (data ?? []).map((r) => String(r.key).slice("senior_pm:".length));
}

export async function isSeniorPm(userId: string): Promise<boolean> {
  const { data } = await createAdminClient().from("app_settings").select("key").eq("key", SENIOR_KEY(userId)).maybeSingle();
  return !!data;
}
