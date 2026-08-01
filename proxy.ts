import type { NextRequest } from "next/server";
import { refreshSupabaseSession } from "@/lib/product/supabase-proxy";

export async function proxy(request: NextRequest) {
  return refreshSupabaseSession(request);
}

export const config = {
  matcher: [
    "/app/:path*",
    "/setup",
    "/login",
    "/api/v1/:path*",
  ],
};
