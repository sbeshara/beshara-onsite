import { redirect } from "next/navigation";
import { getMe } from "@/lib/auth";
import { PHASES } from "@/lib/constants";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdminRole } from "@/lib/types";
import { getViewAs } from "@/lib/viewas";
import BroadcastForm from "./BroadcastForm";

export const metadata = { title: "Message All Clients · Beshara OnSite" };

// Admins only: post one message to many projects' clients at once.
export default async function BroadcastPage() {
  const me = await getMe();
  if (!isAdminRole(me.role) || (await getViewAs())) redirect("/");
  const admin = createAdminClient();
  const [{ data: projects }, { data: members }] = await Promise.all([
    admin.from("projects").select("id, name, town, phase").order("name"),
    admin.from("project_members").select("project_id, profiles!inner(role)").eq("profiles.role", "client"),
  ]);
  const clients: Record<string, number> = {};
  for (const m of members ?? []) clients[m.project_id] = (clients[m.project_id] ?? 0) + 1;
  const rows = (projects ?? []).map((p) => ({ id: p.id, name: p.name, town: p.town ?? "", phase: PHASES[p.phase] ?? "", clients: clients[p.id] ?? 0 }));
  return (
    <div className="page">
      <div className="page-h">
        <h1>Message All Clients</h1>
        <p>
          Write one message and post it to every project you pick. Each project gets it in a client chat with the name below (made if it doesn&apos;t
          exist yet), posted as Beshara Builders. Clients are notified the usual way, by email and on their phone.
        </p>
      </div>
      <BroadcastForm projects={rows} />
    </div>
  );
}
