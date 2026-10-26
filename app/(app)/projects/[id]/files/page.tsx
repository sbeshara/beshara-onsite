import FilesView from "@/components/FilesView";
import { getMe } from "@/lib/auth";
import { signUrls } from "@/lib/storage";
import { createClient } from "@/lib/supabase/server";
import type { FileRow, Profile } from "@/lib/types";

export default async function FilesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await getMe();
  const supabase = await createClient();
  const [{ data: filesData }, { data: peopleData }] = await Promise.all([
    supabase.from("files").select("*").eq("project_id", id).order("created_at", { ascending: false }),
    supabase.from("profiles").select("id, full_name, email"),
  ]);
  const files = (filesData ?? []) as FileRow[];
  const names = Object.fromEntries(((peopleData ?? []) as Pick<Profile, "id" | "full_name" | "email">[]).map((p) => [p.id, p.full_name || p.email]));
  const urls = await signUrls(supabase, files.map((f) => f.storage_path));
  return <FilesView key={files.length} projectId={id} files={files} urls={urls} names={names} me={{ id: me.id, role: me.role }} />;
}
