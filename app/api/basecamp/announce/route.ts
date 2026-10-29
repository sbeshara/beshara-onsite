import { revalidatePath } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";
import { getMe } from "@/lib/auth";
import { BasecampError, connection } from "@/lib/basecamp";
import { moveClients } from "@/lib/basecamp-announce";
import { isAdminRole } from "@/lib/types";

export const maxDuration = 120;

// One project: invite the chosen Basecamp clients to OnSite, then (optionally)
// post the announcement on its Basecamp Message Board.
export async function POST(req: NextRequest) {
  const me = await getMe();
  if (!isAdminRole(me.role)) return NextResponse.json({ error: "Only the Principal Contractor or Admin can do that." }, { status: 403 });
  let body: { projectId?: unknown; emails?: unknown; post?: unknown; subject?: unknown; body?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  const emails = Array.isArray(body.emails) ? body.emails.filter((e): e is string => typeof e === "string").slice(0, 100) : [];
  if (typeof body.projectId !== "string") return NextResponse.json({ error: "Bad request" }, { status: 400 });
  try {
    const conn = await connection();
    if (!conn) return NextResponse.json({ error: "Basecamp isn't connected." }, { status: 400 });
    const result = await moveClients(conn, body.projectId, { emails, post: body.post === true, subject: String(body.subject ?? ""), body: String(body.body ?? "") });
    revalidatePath("/", "layout");
    return NextResponse.json(result);
  } catch (e) {
    console.error("Basecamp announce failed:", e);
    return NextResponse.json({ error: e instanceof BasecampError ? e.message : "Something went wrong on this project." }, { status: 502 });
  }
}
