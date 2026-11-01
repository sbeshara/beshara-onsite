import "server-only";
import { cache } from "react";
import { createAdminClient } from "./supabase/admin";
import type { Role } from "./types";

// Role permissions the Principal Contractor can switch on and off (Team &
// Access → Permissions). Everything else about each role is fixed.
export const PERMISSIONS = [
  {
    key: "pm_send_reports",
    role: "construction",
    label: "Send progress reports",
    detail: "Construction Management can send approved reports for their own jobs to the client, not just approve them.",
    default: false,
  },
  {
    key: "pm_create_projects",
    role: "construction",
    label: "Create projects",
    detail: "Construction Management can create new OnSite projects and import JobTread jobs. They're added to the projects they create.",
    default: false,
  },
  {
    key: "clients_start_chats",
    role: "client",
    label: "Start new chats",
    detail: "Clients can start new chats on their project. Off means only your team creates chats; clients still reply in them.",
    default: true,
  },
] as const;

export type PermissionKey = (typeof PERMISSIONS)[number]["key"];

export const getPermissions = cache(async (): Promise<Record<PermissionKey, boolean>> => {
  const { data } = await createAdminClient().from("app_settings").select("key, value").like("key", "perm:%");
  const saved = new Map((data ?? []).map((r) => [String(r.key).slice(5), r.value === "true"]));
  return Object.fromEntries(PERMISSIONS.map((p) => [p.key, saved.get(p.key) ?? p.default])) as Record<PermissionKey, boolean>;
});

// Whether this role may do this. Admins and the Principal Contractor always can.
export async function allowed(role: Role, key: PermissionKey) {
  if (role === "owner" || role === "admin") return true;
  const perm = PERMISSIONS.find((p) => p.key === key)!;
  return perm.role === role && (await getPermissions())[key];
}
