import "server-only";
import { createAdminClient } from "./supabase/admin";
import type { Role } from "./types";

const siteUrl = () => (process.env.NEXT_PUBLIC_SITE_URL ?? "https://onsite.besharabuilders.com").replace(/\/$/, "");

// Finds the account for this email, or creates it and emails an invite.
// New accounts get the role given here; existing accounts keep theirs.
export async function inviteOrFind(email: string, fullName: string, role: Role, title: string | null) {
  const admin = createAdminClient();
  const address = email.toLowerCase();
  const { data: existing } = await admin.from("profiles").select("id, role").eq("email", address).maybeSingle();
  if (existing) return { id: existing.id as string, role: existing.role as Role, invited: false };

  const { data, error } = await admin.auth.admin.inviteUserByEmail(address, {
    data: { full_name: fullName, title },
    redirectTo: `${siteUrl()}/auth/confirm?next=/welcome`,
  });
  if (error || !data.user) throw new Error(`Couldn't send the invite to ${address}: ${error?.message ?? "unknown error"}`);
  await admin.from("profiles").update({ role, full_name: fullName, title }).eq("id", data.user.id);
  return { id: data.user.id, role, invited: true };
}
