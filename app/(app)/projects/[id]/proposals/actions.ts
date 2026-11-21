"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { getMe } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type Result = { error?: string; ok?: string };

// Lets the office know in the project's Internal Only chat (posted as the company).
async function tellOffice(projectId: string, body: string) {
  const admin = createAdminClient();
  const [{ data: chat }, { data: owner }] = await Promise.all([
    admin.from("chats").select("id").eq("project_id", projectId).eq("is_internal", true).maybeSingle(),
    admin.from("profiles").select("id").eq("role", "owner").limit(1).maybeSingle(),
  ]);
  if (chat && owner) await admin.from("messages").insert({ chat_id: chat.id, author_id: owner.id, body, posted_as: "company" });
}

export async function signProposal(projectId: string, estimateId: string, name: string, signature: string): Promise<Result> {
  try {
    const me = await getMe();
    const h = await headers();
    const from = [h.get("x-forwarded-for")?.split(",")[0], h.get("user-agent")].filter(Boolean).join(" · ");
    const supabase = await createClient();
    const { error } = await supabase.rpc("sign_estimate", { p_id: estimateId, p_name: name, p_signature: signature, p_from: from });
    if (error) return { error: error.message };
    const { data } = await supabase.rpc("client_proposals", { p_project: projectId });
    const doc = ((data ?? []) as { id: string; kind: string; copy: { number: string; total: number } }[]).find((d) => d.id === estimateId);
    const total = doc ? doc.copy.total.toLocaleString("en-US", { style: "currency", currency: "USD" }) : "";
    await tellOffice(projectId, `✅ ${name.trim()} (${me.email}) signed ${doc?.kind ?? "the proposal"} ${doc?.copy.number ?? ""} for ${total}.`);
    revalidatePath(`/projects/${projectId}`, "layout");
    return { ok: "Signed. Thank you! A copy stays here under Proposals." };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function declineProposal(projectId: string, estimateId: string, reason: string): Promise<Result> {
  try {
    const me = await getMe();
    const supabase = await createClient();
    const { error } = await supabase.rpc("decline_estimate", { p_id: estimateId, p_reason: reason });
    if (error) return { error: error.message };
    await tellOffice(projectId, `❌ ${me.full_name || me.email} declined a proposal${reason.trim() ? `: "${reason.trim()}"` : "."}`);
    revalidatePath(`/projects/${projectId}`, "layout");
    return { ok: "Declined. Your Beshara team has been told." };
  } catch (e) {
    return { error: (e as Error).message };
  }
}
