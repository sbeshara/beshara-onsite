import { NextResponse, type NextRequest } from "next/server";
import { getMe } from "@/lib/auth";
import { BasecampError, connection } from "@/lib/basecamp";
import { importFolder, importPost, startProject } from "@/lib/basecamp-import";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdminRole } from "@/lib/types";

export const maxDuration = 300;

type Body =
  | { step: "start"; bcProjectId: number; target: string }
  | { step: "post"; projectId: string; id: number }
  | { step: "folder"; projectId: string; id: number; path: string };

const isId = (n: unknown) => Number.isSafeInteger(n) && (n as number) > 0;

// One step of the import (see lib/basecamp-import.ts).
export async function POST(req: NextRequest) {
  const me = await getMe();
  if (!isAdminRole(me.role)) return NextResponse.json({ error: "Only the Principal Contractor or Admin can import from Basecamp." }, { status: 403 });
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  try {
    const conn = await connection();
    if (!conn) return NextResponse.json({ error: "Basecamp isn't connected. Connect it again.", fatal: true }, { status: 400 });
    if (body.step === "start") {
      if (!isId(body.bcProjectId) || typeof body.target !== "string") return NextResponse.json({ error: "Bad request" }, { status: 400 });
      return NextResponse.json(await startProject(conn, body.bcProjectId, body.target, me.id));
    }
    if (!isId(body.id)) return NextResponse.json({ error: "Bad request" }, { status: 400 });
    // Steps only ever write into a project that was linked to Basecamp at the start.
    const { data: project } = await createAdminClient().from("projects").select("id").eq("id", body.projectId).not("basecamp_project_id", "is", null).maybeSingle();
    if (!project) return NextResponse.json({ error: "That project isn't linked to Basecamp." }, { status: 400 });
    if (body.step === "post") return NextResponse.json(await importPost(conn, project.id, body.id));
    if (body.step === "folder") return NextResponse.json(await importFolder(conn, project.id, body.id, String(body.path ?? "").slice(0, 250)));
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  } catch (e) {
    console.error("Basecamp import step failed:", e);
    const known = e instanceof BasecampError;
    return NextResponse.json({ error: known ? e.message : "Something went wrong on this step.", fatal: known && e.fatal }, { status: 502 });
  }
}
