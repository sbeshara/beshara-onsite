import { redirect } from "next/navigation";
import { getMe } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { isAdminRole, type Profile } from "@/lib/types";
import NewProjectForm from "./NewProjectForm";

export const metadata = { title: "New project · Beshara OnSite" };

export default async function NewProjectPage() {
  const me = await getMe();
  if (!isAdminRole(me.role)) redirect("/");
  const supabase = await createClient();
  const { data } = await supabase.from("profiles").select("id, full_name, email, role, title").eq("role", "construction").order("full_name");
  return (
    <div className="page">
      <div className="page-h">
        <h1>New project</h1>
        <p>The project starts with four chats: Weekly Updates, Selections &amp; Finishes, Schedule &amp; Inspections and Internal Only. The client gets an email invite to set up their account.</p>
      </div>
      <NewProjectForm staff={(data ?? []) as Profile[]} />
    </div>
  );
}
