"use server";

import { revalidatePath } from "next/cache";
import { getMe } from "@/lib/auth";
import { LOG_OWNER_KEY } from "@/lib/checklist";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdminRole } from "@/lib/types";

// Picks who on a job is responsible for its JobTread daily log.
export async function setDailyLogOwner(projectId: string, userId: string): Promise<{ error?: string }> {
  const me = await getMe();
  if (!isAdminRole(me.role)) return { error: "Only the Principal Contractor or Admin can change this." };
  const admin = createAdminClient();
  const { data: member } = await admin
    .from("project_members")
    .select("user_id, profiles!inner(role)")
    .eq("project_id", projectId)
    .eq("user_id", userId)
    .eq("profiles.role", "construction")
    .maybeSingle();
  if (!member) return { error: "That person isn't on this job's Construction Management team." };
  const { error } = await admin.from("app_settings").upsert({ key: LOG_OWNER_KEY(projectId), value: userId });
  if (error) return { error: "Couldn't save that. Try again." };
  revalidatePath("/team");
  return {};
}
