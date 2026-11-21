import { redirect } from "next/navigation";

// Plans live on the project so the whole team can use them.
export default async function OfficePlans({ params }: { params: Promise<{ id: string }> }) {
  redirect(`/projects/${(await params).id}/plans`);
}
