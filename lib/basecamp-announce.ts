import "server-only";
import { BasecampError, bcAll, bcFetch, bcGet, type BcPerson, type BcProject, type Connection } from "./basecamp";
import { createAdminClient } from "./supabase/admin";

// Telling clients about the move: post a client-visible message on each
// imported project's Basecamp Message Board, so Basecamp emails it to the
// project's clients (and only them).

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

export async function announce(conn: Connection, projectId: string, opts: { subject: string; body: string }): Promise<{ posted: number }> {
  const admin = createAdminClient();
  const { data: project } = await admin.from("projects").select("id, basecamp_project_id").eq("id", projectId).maybeSingle();
  if (!project?.basecamp_project_id) throw new BasecampError("That project isn't linked to Basecamp.");
  const subject = opts.subject.trim().slice(0, 200);
  const body = opts.body.trim().slice(0, 5000);
  if (!subject || !body) throw new BasecampError("Add a subject and a message to post.");
  const clients = await basecampClients(conn, project.basecamp_project_id);
  if (!clients.length) throw new BasecampError("No clients on this Basecamp project, so nothing was posted.");
  const bc = await bcGet<BcProject>(conn, `/projects/${project.basecamp_project_id}.json`);
  const board = bc.dock.find((d) => d.name === "message_board" && d.enabled);
  if (!board) throw new BasecampError("This Basecamp project has no Message Board, so nothing was posted.");
  const content = body
    .split(/\n{2,}/)
    .map((para) => `<div>${esc(para).replace(/\n/g, "<br>")}</div>`)
    .join("<div><br></div>");
  await bcFetch(conn, `/message_boards/${board.id}/messages.json`, {
    method: "POST",
    body: { subject, content, status: "active", visible_to_clients: true, subscriptions: clients.map((c) => c.id) },
  });
  await admin.from("app_settings").upsert({ key: ANNOUNCED(projectId), value: new Date().toISOString() });
  return { posted: clients.length };
}
