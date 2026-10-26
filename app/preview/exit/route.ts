import { NextResponse, type NextRequest } from "next/server";
import { PREVIEW_COOKIE } from "@/lib/preview";

export async function GET(request: NextRequest) {
  const project = request.cookies.get(PREVIEW_COOKIE)?.value;
  const res = NextResponse.redirect(new URL(project ? `/projects/${project}` : "/", request.url));
  res.cookies.delete(PREVIEW_COOKIE);
  return res;
}
