import "server-only";
import { BasecampError, bcAll, bcFetch, bcGet, type BcPerson, type BcProject, type Connection } from "./basecamp";
import { inviteOrFind } from "./invite";
import { createAdminClient } from "./supabase/admin";

// Moving clients over: for each imported project, invite its Basecamp
// clients into the OnSite project, then post a client-visible message on the
// project's Basecamp Message Board so Basecamp emails it to them.

export type ClientStatus = "member" | "account" | "new" | "team";
export type ClientRow = { bcId: number; name: string; email: string; title: string | null; company: string | null; status: ClientStatus };
export type ProjectClients = { projectId: string; name: string; announcedAt: string | null; clients: ClientRow[]; error?: string };

const ANNOUNCED = (projectId: string) => `basecamp_announced:${projectId}`;

async function basecampClients(conn: Connection, bcProjectId: string) {
  const people = await bcAll<BcPerson>(conn, `/projects/${bcProjectId}/people.json`);
  return people.filter((p) => p.client && p.email_address);
}

export async function clientsToMove(conn: Connection): Promise<ProjectClients[]> {
  const admin = createAdminClient();
  const [{ data: projects }, { data: profiles }, { data: members }, { data: announced }] = await Promise.all([
    admin.from("projects").select("id, name, basecamp_project_id").not("basecamp_project_id", "is", null).order("name"),
    admin.from("profiles").select("id, email, role"),
    admin.from("project_members").select("project_id, user_id"),
    admin.from("app_settings").select("key, value").like("key", "basecamp_announced:%"),
  ]);
  const byEmail = new Map((profiles ?? []).map((p) => [String(p.email).toLowerCase(), p as { id: string; role: string }]));
  const memberOf = new Set((members ?? []).map((m) => `${m.project_id}:${m.user_id}`));
  const when = new Map((announced ?? []).map((a) => [a.key as string, a.value as string]));
  const out: ProjectClients[] = [];
  for (const p of projects ?? []) {
    try {
      const people = await basecampClients(conn, p.basecamp_project_id as string);
      out.push({
        projectId: p.id,
        name: p.name,
        announcedAt: when.get(ANNOUNCED(p.id)) ?? null,
        clients: people.map((c) => {
          const email = c.email_address!.toLowerCase();
          const found = byEmail.get(email);
          const status: ClientStatus = !found ? "new" : found.role !== "client" ? "team" : memberOf.has(`${p.id}:${found.id}`) ? "member" : "account";
          return { bcId: c.id, name: c.name, email, title: c.title ?? null, company: c.company?.name ?? null, status };
        }),
      });
    } catch (e) {
      out.push({ projectId: p.id, name: p.name, announcedAt: when.get(ANNOUNCED(p.id)) ?? null, clients: [], error: e instanceof BasecampError ? e.message : "Couldn't read this project from Basecamp." });
    }
  }
  return out;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export type MoveResult = { invited: string[]; added: string[]; skipped: string[]; posted: boolean };

export async function moveClients(
  conn: Connection,
  projectId: string,
  opts: { emails: string[]; post: boolean; subject: string; body: string },
): Promise<MoveResult> {
  const admin = createAdminClient();
  const { data: project } = await admin.from("projects").select("id, basecamp_project_id").eq("id", projectId).maybeSingle();
  if (!project?.basecamp_project_id) throw new BasecampError("That project isn't linked to Basecamp.");
  const clients = await basecampClients(conn, project.basecamp_project_id);
  const result: MoveResult = { invited: [], added: [], skipped: [], posted: false };

  // Only people who are clients on this Basecamp project can be invited here.
  const wanted = new Set(opts.emails.map((e) => e.toLowerCase()));
  for (const c of clients.filter((c) => wanted.has(c.email_address!.toLowerCase()))) {
    const email = c.email_address!.toLowerCase();
    try {
      const person = await inviteOrFind(email, c.name, "client", c.title ?? null);
      if (person.role !== "client") {
        result.skipped.push(`${c.name} (${email}) is on the Beshara team, so they weren't added as a client.`);
        continue;
      }
      await admin.from("project_members").upsert({ project_id: projectId, user_id: person.id }, { onConflict: "project_id,user_id", ignoreDuplicates: true });
      await admin.from("projects").update({ primary_client_id: person.id }).eq("id", projectId).is("primary_client_id", null);
      (person.invited ? result.invited : result.added).push(c.name);
    } catch (e) {
      result.skipped.push(`${c.name} (${email}): ${(e as Error).message}`);
    }
  }

  if (opts.post) {
    const subject = opts.subject.trim().slice(0, 200);
    const body = opts.body.trim().slice(0, 5000);
    if (!subject || !body) throw new BasecampError("Add a subject and a message to post.");
    if (!clients.length) {
      result.skipped.push("No clients on this Basecamp project, so nothing was posted.");
    } else {
      const bc = await bcGet<BcProject>(conn, `/projects/${project.basecamp_project_id}.json`);
      const board = bc.dock.find((d) => d.name === "message_board" && d.enabled);
      if (!board) {
        result.skipped.push("This Basecamp project has no Message Board, so nothing was posted.");
      } else {
        const content = body
          .split(/\n{2,}/)
          .map((para) => `<div>${esc(para).replace(/\n/g, "<br>")}</div>`)
          .join("<div><br></div>");
        await bcFetch(conn, `/message_boards/${board.id}/messages.json`, {
          method: "POST",
          body: { subject, content, status: "active", visible_to_clients: true, subscriptions: clients.map((c) => c.id) },
        });
        result.posted = true;
        await admin.from("app_settings").upsert({ key: ANNOUNCED(projectId), value: new Date().toISOString() });
      }
    }
  }
  return result;
}
