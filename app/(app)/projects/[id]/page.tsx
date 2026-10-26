import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// Opening a project lands on its first chat.
export default async function ProjectHome({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase.from("chats").select("id").eq("project_id", id).order("position").order("created_at").limit(1);
  if (!data?.length) notFound();
  redirect(`/projects/${id}/chats/${data[0].id}`);
}
