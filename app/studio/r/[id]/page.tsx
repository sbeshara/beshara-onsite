import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// Old links (and emails) point here; reports now open beside the job list.
export default async function ReportLink({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { data } = await (await createClient()).from("weekly_reports").select("week_start").eq("id", id).maybeSingle();
  if (!data) notFound();
  redirect(`/studio?week=${data.week_start}&r=${id}`);
}
