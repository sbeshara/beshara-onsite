import { redirect } from "next/navigation";
import { getAccess } from "@/lib/access";
import { getPreview } from "@/lib/preview";
import { projectViewer } from "@/lib/viewas";

// Estimates, invoicing and job details: the Owner, Admin, Senior PM and
// Preconstruction Manager only (the database enforces the same rule).
export default async function OfficeTabs({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { seesNumbers } = await getAccess();
  const v = await projectViewer(id);
  if (!seesNumbers || (await getPreview()) || v.viewAs) redirect(`/projects/${id}`);
  return children;
}
