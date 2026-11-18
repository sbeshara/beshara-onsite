import "server-only";
import { ROLE_LABEL } from "./constants";
import { createAdminClient } from "./supabase/admin";
import type { Profile } from "./types";

// Team members the View As picker offers (everyone on the team but yourself),
// Construction Management first.
export async function viewAsPeople(myId: string) {
  const { data } = await createAdminClient().from("profiles").select("id, full_name, email, role").neq("role", "client").neq("id", myId);
  const order = ["construction", "admin", "owner"];
  return ((data ?? []) as Pick<Profile, "id" | "full_name" | "email" | "role">[])
    .sort((a, b) => order.indexOf(a.role) - order.indexOf(b.role) || (a.full_name || a.email).localeCompare(b.full_name || b.email))
    .map((p) => ({ id: p.id, name: p.full_name || p.email, role: ROLE_LABEL[p.role] }));
}
