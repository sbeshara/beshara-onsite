import { notFound, redirect } from "next/navigation";
import { getMe } from "@/lib/auth";
import { loadProjectPeople } from "@/lib/project-people";
import { isAdminRole } from "@/lib/types";
import { getViewAs } from "@/lib/viewas";
import DeleteProject from "./DeleteProject";
import PeopleManager from "./PeopleManager";

export default async function PeoplePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await getMe();
  if (!isAdminRole(me.role)) redirect(`/projects/${id}`);
  const data = await loadProjectPeople(id);
  if (!data) notFound();
  const { name, ...props } = data;
  const viewingAs = !!(await getViewAs());
  return (
    <div className="page" style={{ borderTop: 0 }}>
      <PeopleManager {...props} />
      {!viewingAs && <DeleteProject projectId={id} name={name} />}
    </div>
  );
}
