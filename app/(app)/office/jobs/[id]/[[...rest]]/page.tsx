import { redirect } from "next/navigation";

// Jobs live on one page now (/projects/<id>); old office links forward there.
export default async function OldJobLink({ params }: { params: Promise<{ id: string; rest?: string[] }> }) {
  const { id, rest } = await params;
  redirect(`/projects/${id}/${rest?.length ? rest.join("/") : "details"}`);
}
