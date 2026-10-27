import { NextResponse } from "next/server";
import { getMe } from "@/lib/auth";
import { reportPdf, type WeeklyReport } from "@/lib/reports";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { isTeamRole } from "@/lib/types";

export const maxDuration = 120;

// Preview of the client PDF, built from the saved draft.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await getMe();
  if (!isTeamRole(me.role)) return new NextResponse("Not found", { status: 404 });
  const supabase = await createClient();
  const { data } = await supabase.from("weekly_reports").select("*").eq("id", id).maybeSingle();
  if (!data) return new NextResponse("Not found", { status: 404 });
  const { pdf, fileName } = await reportPdf(createAdminClient(), data as WeeklyReport);
  return new NextResponse(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${fileName.replace(/[^\w .-]/g, "")}"`,
      "Cache-Control": "no-store",
    },
  });
}
