import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { getMe } from "./auth";
import { createAdminClient } from "./supabase/admin";
import { isAdminRole, type Profile } from "./types";

export const VIEW_AS_COOKIE = "onsite_view_as";

export type ViewAs = {
  profile: Profile;
  // The projects they can see; null means every project (Admins, the Principal Contractor).
  projectIds: string[] | null;
  isClient: boolean;
};

// The person the Principal Contractor or an Admin is looking at the app as,
// if any. It's read-only: they still act as themselves, and pages hide
// anything that would post or change something.
export const getViewAs = cache(async (): Promise<ViewAs | null> => {
  const me = await getMe();
  if (!isAdminRole(me.role)) return null;
  const id = (await cookies()).get(VIEW_AS_COOKIE)?.value;
  if (!id || !/^[0-9a-f-]{36}$/i.test(id) || id === me.id) return null;
  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("*").eq("id", id).maybeSingle();
  if (!profile) return null;
  const p = profile as Profile;
  if (isAdminRole(p.role)) return { profile: p, projectIds: null, isClient: false };
  const { data: rows } = await admin.from("project_members").select("project_id").eq("user_id", id);
  return { profile: p, projectIds: (rows ?? []).map((r) => r.project_id as string), isClient: p.role === "client" };
});

// Whether the person being viewed as can open this project.
export const canViewProject = (v: ViewAs, projectId: string) => !v.projectIds || v.projectIds.includes(projectId);

// How a project's pages behave for whoever is looking: the signed-in person,
// the client preview ("View as Client"), or "View as" someone.
export async function projectViewer(projectId: string) {
  const { getPreview } = await import("./preview");
  const me = await getMe();
  const previewing = (await getPreview()) === projectId;
  const viewAs = previewing ? null : await getViewAs();
  const clientOnly = previewing || !!viewAs?.isClient;
  return {
    previewing,
    viewAs,
    // Internal chats and team-only files are hidden.
    clientOnly,
    // Nothing can be posted or changed.
    readOnly: previewing || !!viewAs,
    role: previewing ? ("client" as const) : (viewAs?.profile.role ?? me.role),
    userId: viewAs?.profile.id ?? me.id,
  };
}
