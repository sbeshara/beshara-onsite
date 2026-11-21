import "server-only";
import { createAdminClient } from "./supabase/admin";

// A Senior PM is a Construction Management person who oversees every project:
// they can open all projects, chats, files and progress reports (the database
// allows it through is_senior_pm()), and they see the team check-in board on
// HQ. Their own daily logs, emails and notifications are still only for the
// jobs they're assigned to, and admin-only tools stay admin-only. Kept in
// app_settings.
export const SENIOR_KEY = (userId: string) => `senior_pm:${userId}`;

export async function seniorPmIds(): Promise<string[]> {
  const { data } = await createAdminClient().from("app_settings").select("key").like("key", "senior_pm:%");
  return (data ?? []).map((r) => String(r.key).slice("senior_pm:".length));
}

export async function isSeniorPm(userId: string): Promise<boolean> {
  const { data } = await createAdminClient().from("app_settings").select("key").eq("key", SENIOR_KEY(userId)).maybeSingle();
  return !!data;
}

// A Preconstruction Manager builds bids and scopes: like a Senior PM they see
// every job and lead, plus every number (prices, costs, margins), the
// customers and the catalog. Kept in app_settings as 'precon:<user id>'; the
// database checks it through is_precon().
export const PRECON_KEY = (userId: string) => `precon:${userId}`;

export async function preconIds(): Promise<string[]> {
  const { data } = await createAdminClient().from("app_settings").select("key").like("key", "precon:%");
  return (data ?? []).map((r) => String(r.key).slice("precon:".length));
}
