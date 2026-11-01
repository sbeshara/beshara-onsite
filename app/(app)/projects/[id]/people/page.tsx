import { notFound, redirect } from "next/navigation";
import { getMe } from "@/lib/auth";
import { loadProjectPeople } from "@/lib/project-people";
import { isAdminRole } from "@/lib/types";
import PeopleManager from "./PeopleManager";

export default async function PeoplePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await getMe();
  if (!isAdminRole(me.role)) redirect(`/projects/${id}`);
  const data = await loadProjectPeople(id);
  if (!data) notFound();
  const { name: _name, ...props } = data;
  return (
    <div className="page" style={{ borderTop: 0 }}>
      <PeopleManager {...props} />
    </div>
  );
}
