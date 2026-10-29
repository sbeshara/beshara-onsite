import { plainText } from "@/lib/format";
import { NextResponse, type NextRequest } from "next/server";
import { sendPushes } from "@/lib/notify";
import { createAdminClient } from "@/lib/supabase/admin";

// Called by the database right after a message is posted. Safe to call
// more than once: each message is only ever notified one time.
export async function POST(request: NextRequest) {
  const { id } = (await request.json().catch(() => ({}))) as { id?: string };
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ ok: false }, { status: 400 });
  const admin = createAdminClient();
  const { data } = await admin.rpc("claim_message_push", { p_message: id });
  const m = data?.[0] as { project_id: string; project_name: string; chat_id: string; chat_name: string; author_name: string; body: string } | undefined;
  if (!m) return NextResponse.json({ ok: true, sent: 0 });
  const plain = plainText(m.body ?? "");
  const text = plain ? (plain.length > 160 ? plain.slice(0, 160) + "…" : plain) : "Sent an attachment";
  const sent = await sendPushes(admin, id, {
    title: `${m.author_name} · ${m.chat_name}`,
    body: `${m.project_name}: ${text}`,
    url: `/projects/${m.project_id}/chats/${m.chat_id}`,
    tag: m.chat_id,
  });
  return NextResponse.json({ ok: true, sent });
}
