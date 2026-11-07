"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getMe } from "@/lib/auth";
import { jobContacts, type JobContact } from "@/lib/jobtread";
import { inviteOrFind } from "@/lib/invite";
import { allowed, PERMISSIONS, type PermissionKey } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { isAdminRole, type Role } from "@/lib/types";
import { FILES_BUCKET } from "@/lib/constants";
import { getViewAs } from "@/lib/viewas";
import { SENIOR_KEY } from "@/lib/senior";

export type Result = { error?: string; ok?: string };

const siteUrl = () => (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const clean = (v: FormDataEntryValue | null) => String(v ?? "").trim();
const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

async function requireAdmin() {
  const me = await getMe();
  if (!isAdminRole(me.role)) throw new Error("Only the Principal Contractor or Admin can do that.");
  return me;
}

export async function createProject(_prev: Result, form: FormData): Promise<Result> {
  let projectId: string;
  try {
    const me = await getMe();
    if (!(await allowed(me.role, "pm_create_projects"))) return { error: "Only the Principal Contractor or Admin can create projects." };
    const name = clean(form.get("name"));
    const town = clean(form.get("town"));
    const scope = clean(form.get("scope")) || null;
    const clientName = clean(form.get("client_name"));
    const clientEmail = clean(form.get("client_email"));
    const staff = form.getAll("staff").map(String);
    if (!name || !town || !clientName) return { error: "Fill in the project name, town and client name." };
    if (!isEmail(clientEmail)) return { error: "Enter the client's email address so we can send their invite." };

    const client = await inviteOrFind(clientEmail, clientName, "client", null);
    if (client.role !== "client") return { error: `${clientEmail} belongs to a Beshara team member, not a client.` };

    // Saved with the server's key: PMs may create projects only when that's switched on (checked above).
    const supabase = createAdminClient();
    const { data: project, error } = await supabase
      .from("projects")
      .insert({ name, town, scope, created_by: me.id, primary_client_id: client.id })
      .select("id")
      .single();
    if (error || !project) return { error: "Couldn't create the project. Try again." };
    projectId = project.id;

    // A PM who creates a project is on it.
    const members = [...new Set([client.id, ...staff, ...(me.role === "construction" ? [me.id] : [])])].map((user_id) => ({ project_id: project.id, user_id }));
    const { error: memberErr } = await supabase.from("project_members").insert(members);
    if (memberErr) return { error: "The project was created, but adding people failed. Open Team & Clients to add them." };
  } catch (e) {
    return { error: (e as Error).message };
  }
  revalidatePath("/", "layout");
  redirect(`/projects/${projectId}`);
}

export async function setProjectTeam(projectId: string, staffIds: string[]): Promise<Result> {
  try {
    await requireAdmin();
    const supabase = await createClient();
    const { data: current } = await supabase.from("project_members").select("user_id, profiles(role)").eq("project_id", projectId);
    const currentStaff = ((current ?? []) as unknown as { user_id: string; profiles: { role: Role } | null }[])
      .filter((m) => m.profiles?.role === "construction")
      .map((m) => m.user_id);
    const remove = currentStaff.filter((id) => !staffIds.includes(id));
    const add = staffIds.filter((id) => !currentStaff.includes(id));
    if (remove.length) await supabase.from("project_members").delete().eq("project_id", projectId).in("user_id", remove);
    if (add.length) await supabase.from("project_members").insert(add.map((user_id) => ({ project_id: projectId, user_id })));
  } catch (e) {
    return { error: (e as Error).message };
  }
  revalidatePath("/", "layout");
  return { ok: "Saved. Assigned people can now see this project." };
}

// Contacts from the linked JobTread job that aren't on the project yet, to
// pre-fill the Invite Client form. Nothing is sent from here.
export async function jobTreadContacts(projectId: string): Promise<{ contacts: JobContact[]; error?: string }> {
  try {
    await requireAdmin();
    const admin = createAdminClient();
    const { data: project } = await admin.from("projects").select("jobtread_job_id").eq("id", projectId).single();
    if (!project?.jobtread_job_id) return { contacts: [], error: "not-linked" };
    const [contacts, { data: members }] = await Promise.all([
      jobContacts(project.jobtread_job_id),
      admin.from("project_members").select("profiles(email)").eq("project_id", projectId),
    ]);
    const onProject = new Set(((members ?? []) as unknown as { profiles: { email: string } | null }[]).map((m) => m.profiles?.email.toLowerCase()));
    return { contacts: contacts.filter((c) => !onProject.has(c.email)) };
  } catch (e) {
    return { contacts: [], error: (e as Error).message };
  }
}

// Assigns (or unassigns) one Construction Management teammate to one job.
export async function setAssignment(userId: string, projectId: string, assigned: boolean): Promise<Result> {
  try {
    await requireAdmin();
    const supabase = await createClient();
    const { data: person } = await supabase.from("profiles").select("full_name, role").eq("id", userId).maybeSingle();
    if (person?.role !== "construction") return { error: "Admins and the Principal Contractor already see every job." };
    const { data: project } = await supabase.from("projects").select("name").eq("id", projectId).maybeSingle();
    if (!project) return { error: "That project no longer exists." };
    const { error } = assigned
      ? await supabase.from("project_members").upsert({ project_id: projectId, user_id: userId }, { onConflict: "project_id,user_id", ignoreDuplicates: true })
      : await supabase.from("project_members").delete().eq("project_id", projectId).eq("user_id", userId);
    if (error) return { error: "Couldn't save that. Try again." };
    revalidatePath("/", "layout");
    return { ok: assigned ? `${person.full_name} now sees ${project.name}.` : `${person.full_name} no longer sees ${project.name}.` };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function addClientContact(projectId: string, _prev: Result, form: FormData): Promise<Result> {
  try {
    await requireAdmin();
    const name = clean(form.get("name"));
    const title = clean(form.get("title")) || null;
    const email = clean(form.get("email"));
    if (!name) return { error: "Enter the contact's name." };
    if (!isEmail(email)) return { error: "Enter a valid email address." };
    const person = await inviteOrFind(email, name, "client", title);
    if (person.role !== "client") return { error: `${email} belongs to a Beshara team member. Assign them in the team list above instead.` };
    const supabase = await createClient();
    const { error } = await supabase.from("project_members").upsert({ project_id: projectId, user_id: person.id }, { onConflict: "project_id,user_id", ignoreDuplicates: true });
    if (error) return { error: "Couldn't add that contact. Try again." };
    // The first client added to a project becomes its main contact.
    await createAdminClient().from("projects").update({ primary_client_id: person.id }).eq("id", projectId).is("primary_client_id", null);
    revalidatePath("/", "layout");
    return { ok: person.invited ? `Invite sent to ${email}.` : `${name} already has an account and now has access to this project.` };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function removeClientContact(projectId: string, userId: string): Promise<Result> {
  try {
    await requireAdmin();
    const supabase = await createClient();
    const { data: project } = await supabase.from("projects").select("primary_client_id").eq("id", projectId).single();
    if (project?.primary_client_id === userId) return { error: "That's the main client contact. Make someone else the main contact first." };
    await supabase.from("project_members").delete().eq("project_id", projectId).eq("user_id", userId);
  } catch (e) {
    return { error: (e as Error).message };
  }
  revalidatePath("/", "layout");
  return { ok: "Removed. They no longer see this project." };
}

export async function setMainContact(projectId: string, userId: string): Promise<Result> {
  try {
    await requireAdmin();
    const supabase = await createClient();
    const { error } = await supabase.from("projects").update({ primary_client_id: userId }).eq("id", projectId);
    if (error) return { error: "Couldn't change the main contact." };
  } catch (e) {
    return { error: (e as Error).message };
  }
  revalidatePath("/", "layout");
  return { ok: "Main contact updated." };
}

// Sends the invite again, or a set-password link if they've already joined.
export async function resendInvite(userId: string): Promise<Result> {
  try {
    await requireAdmin();
    const admin = createAdminClient();
    const { data } = await admin.auth.admin.getUserById(userId);
    const email = data.user?.email;
    if (!email) return { error: "That person has no email address on file." };
    if (!data.user?.last_sign_in_at) {
      const { error } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo: `${siteUrl()}/auth/confirm?next=/welcome` });
      if (!error) return { ok: `Invite sent again to ${email}.` };
    }
    const { error } = await admin.auth.resetPasswordForEmail(email, { redirectTo: `${siteUrl()}/auth/confirm?next=/welcome?reset=1` });
    if (error) return { error: `Couldn't email ${email}: ${error.message}` };
    return { ok: `Sent ${email} a link to set their password.` };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function inviteTeamMember(_prev: Result, form: FormData): Promise<Result> {
  try {
    const me = await getMe();
    if (!(await allowed(me.role, "pm_create_projects"))) return { error: "Only the Principal Contractor or Admin can create projects." };
    const name = clean(form.get("name"));
    const email = clean(form.get("email"));
    const role = clean(form.get("role")) as Role;
    if (!name) return { error: "Enter their name." };
    if (!isEmail(email)) return { error: "Enter a valid email address." };
    if (role !== "construction" && role !== "admin") return { error: "Choose a role." };
    if (role === "admin" && me.role !== "owner") return { error: "Only the Principal Contractor can add another Admin." };
    const person = await inviteOrFind(email, name, role, null);
    if (!person.invited) {
      if (person.role === "client") return { error: `${email} is a client account. Use a different email for team members.` };
      return { error: `${email} is already on the team.` };
    }
    revalidatePath("/team");
    return { ok: `Invite sent to ${email}.` };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function setRole(userId: string, role: Role): Promise<Result> {
  try {
    const me = await getMe();
    if (me.role !== "owner") return { error: "Only the Principal Contractor can change roles." };
    if (userId === me.id) return { error: "You can't change your own role." };
    if (role !== "admin" && role !== "construction") return { error: "Choose Admin or Construction Management." };
    const admin = createAdminClient();
    const { data: target } = await admin.from("profiles").select("role").eq("id", userId).single();
    if (!target || target.role === "client" || target.role === "owner") return { error: "That person's role can't be changed here." };
    await admin.from("profiles").update({ role }).eq("id", userId);
  } catch (e) {
    return { error: (e as Error).message };
  }
  revalidatePath("/team");
  return { ok: "Role updated." };
}

// Makes a Construction Management person a Senior PM (or not): they also see
// HQ's team check-in board. Nothing else about their access changes.
export async function setSeniorPm(userId: string, on: boolean): Promise<Result> {
  try {
    await requireAdmin();
    if (await getViewAs()) return { error: "You're viewing as someone else. Exit View As first." };
    const admin = createAdminClient();
    const { data: target } = await admin.from("profiles").select("role, full_name").eq("id", userId).maybeSingle();
    if (target?.role !== "construction") return { error: "Only Construction Management people can be a Senior PM." };
    const { error } = on
      ? await admin.from("app_settings").upsert({ key: SENIOR_KEY(userId), value: "1" })
      : await admin.from("app_settings").delete().eq("key", SENIOR_KEY(userId));
    if (error) return { error: "Couldn't save that. Try again." };
    revalidatePath("/team");
    const first = String(target.full_name || "They").split(" ")[0];
    return { ok: on ? `${first} is a Senior PM: they now see the team check-in board on HQ.` : `${first} is no longer a Senior PM.` };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

// Removes a team member's access to the app entirely.
export async function removeTeamMember(userId: string): Promise<Result> {
  try {
    const me = await requireAdmin();
    if (userId === me.id) return { error: "You can't remove yourself." };
    const admin = createAdminClient();
    const { data: target } = await admin.from("profiles").select("role").eq("id", userId).single();
    if (!target || target.role === "owner" || target.role === "client") return { error: "That person can't be removed here." };
    if (target.role === "admin" && me.role !== "owner") return { error: "Only the Principal Contractor can remove an Admin." };
    const { error } = await admin.auth.admin.deleteUser(userId);
    if (error) return { error: "Couldn't remove them. Try again." };
  } catch (e) {
    return { error: (e as Error).message };
  }
  revalidatePath("/team");
  return { ok: "Removed. They can no longer sign in." };
}

// Switches a role permission on or off (Team & Access → Permissions).
export async function setPermission(key: PermissionKey, on: boolean): Promise<Result> {
  const me = await getMe();
  if (me.role !== "owner") return { error: "Only the Principal Contractor can change permissions." };
  if (!PERMISSIONS.some((p) => p.key === key)) return { error: "Unknown permission." };
  const { error } = await createAdminClient().from("app_settings").upsert({ key: `perm:${key}`, value: on ? "true" : "false" });
  if (error) return { error: "Couldn't save that. Try again." };
  revalidatePath("/", "layout");
  return { ok: "Saved." };
}

// Deletes a project for good: its chats, messages, files (and the stored
// copies), progress reports and checklist history. People stay: clients keep
// their login for any other projects. The name must be typed to confirm.
export async function deleteProject(projectId: string, typedName: string): Promise<Result> {
  try {
    await requireAdmin();
    if (await getViewAs()) return { error: "You're viewing as someone else. Exit View As first." };
    const admin = createAdminClient();
    const { data: project } = await admin.from("projects").select("id, name").eq("id", projectId).maybeSingle();
    if (!project) return { error: "That project is already gone." };
    if (typedName.trim().toLowerCase() !== String(project.name).trim().toLowerCase()) return { error: `Type the project name exactly (${project.name}) to delete it.` };
    // Every stored file lives under <projectId>/ in the bucket.
    for (;;) {
      const { data: objects, error } = await admin.storage.from(FILES_BUCKET).list(projectId, { limit: 1000 });
      if (error) return { error: "Couldn't remove the project's files. Nothing was deleted; try again." };
      if (!objects?.length) break;
      const { error: rmError } = await admin.storage.from(FILES_BUCKET).remove(objects.map((o) => `${projectId}/${o.name}`));
      if (rmError) return { error: "Couldn't remove the project's files. Try again." };
      if (objects.length < 1000) break;
    }
    const { error } = await admin.from("projects").delete().eq("id", projectId);
    if (error) return { error: "Couldn't delete the project. Try again." };
    await admin.from("app_settings").delete().in("key", [`dailylog:${projectId}`, `basecamp_announced:${projectId}`]);
  } catch (e) {
    return { error: (e as Error).message };
  }
  revalidatePath("/", "layout");
  redirect("/?deleted=1");
}
