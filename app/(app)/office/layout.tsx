import { redirect } from "next/navigation";
import { getAccess } from "@/lib/access";
import { getPreview } from "@/lib/preview";
import { getViewAs } from "@/lib/viewas";

// The office tools: Owner, Admin, Senior PM and Preconstruction Manager only.
export default async function OfficeLayout({ children }: { children: React.ReactNode }) {
  const access = await getAccess();
  if (!access.seesNumbers || (await getPreview()) || (await getViewAs())) redirect("/");
  return children;
}
