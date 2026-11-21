import { NextResponse, type NextRequest } from "next/server";
import { recordPayment, removePayment } from "@/lib/invoicing";
import { api, verifyWebhook, type QboPayment } from "@/lib/qbo";

// QuickBooks tells us when a payment is recorded, changed or deleted.
export async function POST(req: NextRequest) {
  const body = await req.text();
  if (!verifyWebhook(body, req.headers.get("intuit-signature"))) return new NextResponse("bad signature", { status: 401 });
  type Event = { realmId: string; dataChangeEvent?: { entities: { name: string; id: string; operation: string }[] } };
  const events = (JSON.parse(body) as { eventNotifications?: Event[] }).eventNotifications ?? [];
  for (const e of events) {
    for (const ent of e.dataChangeEvent?.entities ?? []) {
      if (ent.name !== "Payment") continue;
      try {
        if (ent.operation === "Delete" || ent.operation === "Void") await removePayment(ent.id);
        else await recordPayment((await api<{ Payment: QboPayment }>("GET", `/payment/${ent.id}`)).Payment);
      } catch {
        // "Check now" (and the next webhook) picks up anything missed.
      }
    }
  }
  return NextResponse.json({ ok: true });
}
