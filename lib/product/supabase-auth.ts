import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { ProductError } from "./errors";
import { productFailure, productSuccess, readJson, requestId } from "./http";

type CookieWrite = { name: string; value: string; options: CookieOptions };

function config(): { url: string; key: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = (
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY
  )?.trim();
  if (!url || !key) {
    throw new ProductError(
      "AUTH_CONFIG_UNAVAILABLE",
      "Supabase Auth is not configured for this deployment.",
      503,
    );
  }
  return { url, key };
}

function parseCookies(header: string | null): Array<{ name: string; value: string }> {
  if (!header) return [];
  return header.split(";").flatMap((part) => {
    const index = part.indexOf("=");
    if (index < 1) return [];
    return [{ name: part.slice(0, index).trim(), value: part.slice(index + 1).trim() }];
  });
}

function serializeCookie(cookie: CookieWrite): string {
  const parts = [`${cookie.name}=${cookie.value}`];
  const options = cookie.options;
  if (options.maxAge !== undefined) parts.push(`Max-Age=${Math.floor(options.maxAge)}`);
  if (options.domain) parts.push(`Domain=${options.domain}`);
  parts.push(`Path=${options.path ?? "/"}`);
  if (options.httpOnly) parts.push("HttpOnly");
  if (options.secure) parts.push("Secure");
  if (options.sameSite) {
    const sameSite = options.sameSite === true ? "Strict" :
      `${options.sameSite.charAt(0).toUpperCase()}${options.sameSite.slice(1)}`;
    parts.push(`SameSite=${sameSite}`);
  }
  return parts.join("; ");
}

function siteUrl(request: Request): URL {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  return new URL(configured || new URL(request.url).origin);
}

export function resolveSafeNext(request: Request, input: unknown, fallback = "/setup"): string {
  if (typeof input !== "string" || !input.startsWith("/") || input.startsWith("//")) {
    return fallback;
  }
  if (input.includes("\\")) return fallback;
  let decoded = input;
  try {
    for (let index = 0; index < 2; index += 1) decoded = decodeURIComponent(decoded);
  } catch {
    return fallback;
  }
  if (!decoded.startsWith("/") || decoded.startsWith("//") || decoded.includes("\\")) {
    return fallback;
  }
  const site = siteUrl(request);
  const resolved = new URL(decoded, site);
  if (resolved.origin !== site.origin) return fallback;
  return `${resolved.pathname}${resolved.search}${resolved.hash}`;
}

function callbackUrl(request: Request, next: unknown): string {
  const callback = new URL("/api/v1/auth/callback", siteUrl(request));
  callback.searchParams.set("next", resolveSafeNext(request, next));
  return callback.toString();
}

export async function requestOtp(request: Request): Promise<Response> {
  const id = requestId(request);
  try {
    const input = await readJson(request);
    const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new ProductError("VALIDATION_ERROR", "A valid email address is required.");
    }
    const auth = config();
    const client = createClient(auth.url, auth.key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error } = await client.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: callbackUrl(request, input.next), shouldCreateUser: true },
    });
    if (error) throw new ProductError("UNAUTHENTICATED", error.message, 401);
    return productSuccess(id, {
      sent: true,
      message: "Check your email for the secure Commonstate sign-in link.",
    });
  } catch (error) {
    return productFailure(error, id);
  }
}

export async function requestOAuth(request: Request): Promise<Response> {
  const id = requestId(request);
  try {
    const input = await readJson(request);
    if (input.provider !== "google") {
      throw new ProductError("VALIDATION_ERROR", "Only the configured Google provider is supported.");
    }
    const auth = config();
    const client = createClient(auth.url, auth.key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await client.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: callbackUrl(request, input.next), skipBrowserRedirect: true },
    });
    if (error || !data.url) {
      throw new ProductError("UNAUTHENTICATED", error?.message ?? "Google sign-in is unavailable.", 401);
    }
    return productSuccess(id, { url: data.url, provider: "google" });
  } catch (error) {
    return productFailure(error, id);
  }
}

export async function requestSso(request: Request): Promise<Response> {
  const id = requestId(request);
  try {
    const input = await readJson(request);
    const domain = typeof input.domain === "string" ? input.domain.trim().toLowerCase() : "";
    const providerId = typeof input.providerId === "string" ? input.providerId.trim() : "";
    if (!domain && !providerId) {
      throw new ProductError("VALIDATION_ERROR", "domain or providerId is required for SSO.");
    }
    const auth = config();
    const client = createClient(auth.url, auth.key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const identity = domain ? { domain } : { providerId };
    const { data, error } = await client.auth.signInWithSSO({
      ...identity,
      options: { redirectTo: callbackUrl(request, input.next), skipBrowserRedirect: true },
    });
    if (error || !data.url) {
      throw new ProductError("UNAUTHENTICATED", error?.message ?? "Enterprise SSO is unavailable.", 401);
    }
    return productSuccess(id, { url: data.url, provider: "enterprise-sso" });
  } catch (error) {
    return productFailure(error, id);
  }
}

export async function authCallback(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const next = resolveSafeNext(request, url.searchParams.get("next"));
  const destination = new URL(next, siteUrl(request));
  const login = new URL("/login", siteUrl(request));
  const code = url.searchParams.get("code");
  if (!code) {
    login.searchParams.set("error", "missing_auth_code");
    return Response.redirect(login, 303);
  }
  try {
    const auth = config();
    const writes: CookieWrite[] = [];
    const client = createServerClient(auth.url, auth.key, {
      cookies: {
        getAll: () => parseCookies(request.headers.get("cookie")),
        setAll: (cookies) => {
          writes.push(...cookies);
        },
      },
    });
    const { error } = await client.auth.exchangeCodeForSession(code);
    if (error) throw error;
    const response = Response.redirect(destination, 303);
    for (const cookie of writes) response.headers.append("set-cookie", serializeCookie(cookie));
    response.headers.set("cache-control", "no-store, max-age=0");
    return response;
  } catch {
    login.searchParams.set("error", "auth_exchange_failed");
    return Response.redirect(login, 303);
  }
}

export async function signOut(request: Request): Promise<Response> {
  const id = requestId(request);
  try {
    const auth = config();
    const writes: CookieWrite[] = [];
    const client = createServerClient(auth.url, auth.key, {
      cookies: {
        getAll: () => parseCookies(request.headers.get("cookie")),
        setAll: (cookies) => {
          writes.push(...cookies);
        },
      },
    });
    const { error } = await client.auth.signOut();
    if (error) throw new ProductError("UNAUTHENTICATED", error.message, 401);
    const headers = new Headers();
    for (const cookie of writes) headers.append("set-cookie", serializeCookie(cookie));
    return productSuccess(id, { signedOut: true }, 200, headers);
  } catch (error) {
    return productFailure(error, id);
  }
}
