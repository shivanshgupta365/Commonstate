import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

/**
 * Refreshes the Supabase PKCE session and mirrors rotated cookies onto the
 * browser response. Authorization still happens inside the product API from a
 * freshly verified principal; this boundary only keeps the browser and server
 * session stores synchronized.
 */
export async function refreshSupabaseSession(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = (
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.SUPABASE_ANON_KEY
  )?.trim();
  if (!url || !key || request.nextUrl.pathname.startsWith("/api/v1/webhooks/")) {
    return NextResponse.next({ request });
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient(url, key, {
    auth: { persistSession: true, autoRefreshToken: false },
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
        Object.entries(headers).forEach(([name, value]) => {
          response.headers.set(name, value);
        });
      },
    },
  });

  // getClaims verifies the JWT and refreshes an expired access token when the
  // cookie contains a usable refresh token. API authorization still calls
  // getUser so revocation is observed immediately.
  await supabase.auth.getClaims();
  return response;
}
