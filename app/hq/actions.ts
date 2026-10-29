"use server";

import { revalidatePath } from "next/cache";
import { getMe } from "@/lib/auth";
import { njNow } from "@/lib/checklist";
import { createClient } from "@/lib/supabase/server";
import { isTeamRole } from "@/lib/types";

export type Result = { ok?: string; error?: string };

// Ticks one of my jobs as looked at today, with an optional note.
export async function checkJob(projectId: string, note: string): Promise<Result> {
  const me = await getMe();
  if (!isTeamRole(me.role)) return { error: "The checklist is for the Beshara team." };
  const supabase = await createClient();
  const day = njNow().day;
  // Adding a note replaces today's check-in (PMs can add and remove their own, not edit them).
  const { data: prior } = await supabase.from("daily_checks").select("checked_at").eq("project_id", projectId).eq("user_id", me.id).eq("day", day).maybeSingle();
  if (prior) await supabase.from("daily_checks").delete().eq("project_id", projectId).eq("user_id", me.id).eq("day", day);
  const { error } = await supabase
    .from("daily_checks")
    .insert({ project_id: projectId, user_id: me.id, day, note: note.trim().slice(0, 300), checked_at: prior?.checked_at ?? new Date().toISOString() });
  if (error) return { error: "Couldn't save that. You may not be assigned to this job anymore." };
  revalidatePath("/hq");
  return { ok: "Checked off." };
}

export async function uncheckJob(projectId: string): Promise<Result> {
  const me = await getMe();
  const { error } = await (await createClient()).from("daily_checks").delete().eq("project_id", projectId).eq("user_id", me.id).eq("day", njNow().day);
  if (error) return { error: "Couldn't undo that. Try again." };
  revalidatePath("/hq");
  return { ok: "Unchecked." };
}
