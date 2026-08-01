import { createHash, timingSafeEqual } from "node:crypto";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { and, asc, eq } from "drizzle-orm";
import { getDb } from "../../db";
import {
  memberships,
  organizations,
  profiles,
  roles,
  scopeGrants,
  scopes,
  serviceAccounts,
  workspaces,
} from "../../db/schema";
import { ProductError, isDatabaseUnavailable } from "./errors";
import { ensureLocalBootstrap } from "./repository";
import {
  systemClock,
  type AuthenticatedPrincipal,
  type CommandContext,
} from "./types";

export type ProductSession = {
  principal: AuthenticatedPrincipal;
  memberships: Array<{
    id: string;
    organization: { id: string; slug: string; name: string };
    workspace: { id: string; slug: string; name: string; kind: string; status: string };
    role: { id: string; key: string; name: string; permissions: string[] };
  }>;
  authMode: "supabase" | "service-account" | "local-bootstrap";
};

function parseCookies(header: string | null): Array<{ name: string; value: string }> {
  if (!header) return [];
  return header.split(";").flatMap((part) => {
    const index = part.indexOf("=");
    if (index < 1) return [];
    return [{ name: part.slice(0, index).trim(), value: part.slice(index + 1).trim() }];
  });
}

function localBootstrapAllowed(): boolean {
  if (process.env.VERCEL || process.env.CI) return false;
  if (process.env.COMMONSTATE_LOCAL_AUTH === "false") return false;
  const databaseUrl = process.env.DATABASE_URL ?? "";
  const localDatabase = /(?:localhost|127\.0\.0\.1|\[::1\])(?::|\/)/.test(databaseUrl);
  if (!localDatabase) return false;
  return process.env.COMMONSTATE_LOCAL_AUTH === "true" || !process.env.VERCEL;
}

function serviceToken(request: Request): string | null {
  const authorization = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  return match?.[1]?.startsWith("cs_sa_") ? match[1] : null;
}

function regularBearer(request: Request): string | null {
  const authorization = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  const token = match?.[1] ?? null;
  return token && !token.startsWith("cs_sa_") ? token : null;
}

async function authenticateServiceAccount(token: string): Promise<AuthenticatedPrincipal> {
  const separator = token.indexOf(".");
  if (separator < 7) {
    throw new ProductError("UNAUTHENTICATED", "Service-account credential is invalid.", 401);
  }
  const prefix = token.slice(0, separator);
  const secret = token.slice(separator + 1);
  const db = getDb();
  const [account] = await db
    .select()
    .from(serviceAccounts)
    .where(eq(serviceAccounts.keyPrefix, prefix))
    .limit(1);
  if (!account || !account.active || !secret) {
    throw new ProductError("UNAUTHENTICATED", "Service-account credential is invalid.", 401);
  }
  if (account.expiresAt && new Date(account.expiresAt).getTime() <= Date.now()) {
    throw new ProductError("UNAUTHENTICATED", "Service-account credential has expired.", 401);
  }
  const candidate = Buffer.from(createHash("sha256").update(secret).digest("hex"));
  const expected = Buffer.from(account.secretHash);
  if (candidate.length !== expected.length || !timingSafeEqual(candidate, expected)) {
    throw new ProductError("UNAUTHENTICATED", "Service-account credential is invalid.", 401);
  }
  await db
    .update(serviceAccounts)
    .set({ lastUsedAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
    .where(eq(serviceAccounts.id, account.id));
  return {
    type: "service_account",
    principalId: account.id,
    actorId: `service-account:${account.id}`,
    email: null,
    displayName: account.name,
    permissions: account.permissions,
    allowedScopeIds: account.allowedScopeIds,
    workspaceId: account.workspaceId,
    organizationId: account.organizationId,
    authenticatedAt: null,
  };
}

async function authenticateSupabase(request: Request): Promise<AuthenticatedPrincipal | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = (
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY
  )?.trim();
  if (!url || !key) return null;

  const bearer = regularBearer(request);
  const client = bearer
    ? createClient(url, key, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { headers: { Authorization: `Bearer ${bearer}` } },
      })
    : createServerClient(url, key, {
        cookies: {
          getAll: () => parseCookies(request.headers.get("cookie")),
          setAll: () => {
            // Route handlers are read-only with respect to auth cookies. The
            // browser auth callback owns session refresh and cookie rotation.
          },
        },
      });

  const { data, error } = await client.auth.getUser(bearer ?? undefined);
  if (error || !data.user) {
    throw new ProductError("UNAUTHENTICATED", "A valid Supabase session is required.", 401);
  }
  const displayName =
    (typeof data.user.user_metadata?.full_name === "string" &&
      data.user.user_metadata.full_name) ||
    data.user.email ||
    "Commonstate user";
  return {
    type: "user",
    principalId: data.user.id,
    actorId: `user:${data.user.id}`,
    email: data.user.email ?? null,
    displayName,
    authenticatedAt: data.user.last_sign_in_at ?? null,
  };
}

async function principalForRequest(
  request: Request,
): Promise<{ principal: AuthenticatedPrincipal; mode: ProductSession["authMode"] }> {
  try {
    const token = serviceToken(request);
    if (token) {
      return { principal: await authenticateServiceAccount(token), mode: "service-account" };
    }
    const supabase = await authenticateSupabase(request);
    if (supabase) return { principal: supabase, mode: "supabase" };
    if (!localBootstrapAllowed()) {
      throw new ProductError(
        "AUTH_CONFIG_UNAVAILABLE",
        "Supabase Auth is not configured for this deployment.",
        503,
      );
    }
    const principal: AuthenticatedPrincipal = {
      type: "user",
      principalId: "local-private-beta-owner",
      actorId: "user:local-private-beta-owner",
      email: "owner@local.commonstate",
      displayName: "Local workspace owner",
      authenticatedAt: null,
    };
    await ensureLocalBootstrap(principal);
    return { principal, mode: "local-bootstrap" };
  } catch (error) {
    if (error instanceof ProductError) throw error;
    if (isDatabaseUnavailable(error)) {
      throw new ProductError(
        "STORAGE_UNAVAILABLE",
        "PostgreSQL storage is unavailable.",
        503,
      );
    }
    throw error;
  }
}

export async function resolveProductSession(request: Request): Promise<ProductSession> {
  const { principal, mode } = await principalForRequest(request);
  if (principal.type === "service_account") {
    const db = getDb();
    const rows = await db
      .select({
        workspace: workspaces,
        organization: organizations,
        role: roles,
      })
      .from(workspaces)
      .innerJoin(organizations, eq(workspaces.organizationId, organizations.id))
      .innerJoin(serviceAccounts, eq(serviceAccounts.workspaceId, workspaces.id))
      .leftJoin(roles, eq(roles.id, serviceAccounts.roleId))
      .where(eq(serviceAccounts.id, principal.principalId))
      .limit(1);
    return {
      principal,
      authMode: mode,
      memberships: rows.map((row) => ({
        id: `service-account-membership:${principal.principalId}`,
        organization: {
          id: row.organization.id,
          slug: row.organization.slug,
          name: row.organization.name,
        },
        workspace: {
          id: row.workspace.id,
          slug: row.workspace.slug,
          name: row.workspace.name,
          kind: row.workspace.kind,
          status: row.workspace.status,
        },
        role: {
          id: row.role?.id ?? "service-account-role",
          key: row.role?.roleKey ?? "service_account",
          name: row.role?.name ?? "Service account",
          permissions: principal.permissions ?? [],
        },
      })),
    };
  }

  const db = getDb();
  const rows = await db
    .select({
      membership: memberships,
      workspace: workspaces,
      organization: organizations,
      role: roles,
    })
    .from(memberships)
    .innerJoin(workspaces, eq(memberships.workspaceId, workspaces.id))
    .innerJoin(organizations, eq(memberships.organizationId, organizations.id))
    .innerJoin(roles, eq(memberships.roleId, roles.id))
    .where(and(eq(memberships.profileId, principal.principalId), eq(memberships.status, "active")))
    .orderBy(asc(memberships.createdAt), asc(memberships.id));
  return {
    principal,
    authMode: mode,
    memberships: rows.map((row) => ({
      id: row.membership.id,
      organization: {
        id: row.organization.id,
        slug: row.organization.slug,
        name: row.organization.name,
      },
      workspace: {
        id: row.workspace.id,
        slug: row.workspace.slug,
        name: row.workspace.name,
        kind: row.workspace.kind,
        status: row.workspace.status,
      },
      role: {
        id: row.role.id,
        key: row.role.roleKey,
        name: row.role.name,
        permissions: row.role.permissions,
      },
    })),
  };
}

export async function resolveCommandContext(
  request: Request,
  workspaceSlug?: string,
): Promise<CommandContext> {
  const session = await resolveProductSession(request);
  const selected = workspaceSlug
    ? session.memberships.find((item) => item.workspace.slug === workspaceSlug)
    : session.memberships[0];
  if (!selected) {
    throw new ProductError(
      workspaceSlug ? "FORBIDDEN" : "NOT_FOUND",
      workspaceSlug
        ? "The requested workspace is not available to this principal."
        : "No active workspace membership exists.",
      workspaceSlug ? 403 : 404,
    );
  }
  if (selected.workspace.status !== "active") {
    throw new ProductError("FORBIDDEN", "The workspace is not active.", 403);
  }
  const db = getDb();
  const grants = await db
    .select()
    .from(scopeGrants)
    .where(
      and(
        eq(scopeGrants.workspaceId, selected.workspace.id),
        eq(scopeGrants.principalType, session.principal.type),
        eq(scopeGrants.principalId, session.principal.principalId),
      ),
    )
    .orderBy(asc(scopeGrants.createdAt), asc(scopeGrants.id));
  const workspaceScopes = await db
    .select({ id: scopes.id, parentScopeId: scopes.parentScopeId })
    .from(scopes)
    .where(eq(scopes.workspaceId, selected.workspace.id))
    .orderBy(asc(scopes.createdAt), asc(scopes.id));
  const allowed = new Set(
    session.principal.allowedScopeIds ?? grants.flatMap((grant) => (grant.scopeId ? [grant.scopeId] : [])),
  );
  for (const grant of grants) {
    if (!grant.scopeId || grant.constraints.descendants !== true) continue;
    let changed = true;
    while (changed) {
      changed = false;
      for (const scope of workspaceScopes) {
        if (scope.parentScopeId && allowed.has(scope.parentScopeId) && !allowed.has(scope.id)) {
          allowed.add(scope.id);
          changed = true;
        }
      }
    }
  }
  const allowedScopeIds = Array.from(allowed).sort();
  const permissions = Array.from(
    new Set([
      ...selected.role.permissions,
      ...(session.principal.permissions ?? []),
      ...grants.flatMap((grant) => grant.permissions),
    ]),
  ).sort();
  return {
    principal: {
      type: session.principal.type,
      principalId: session.principal.principalId,
      actorId:
        session.principal.type === "user"
          ? `actor:${selected.workspace.id}:${session.principal.principalId}`
          : session.principal.actorId,
    },
    organizationId: selected.organization.id,
    workspaceId: selected.workspace.id,
    workspaceSlug: selected.workspace.slug,
    allowedScopeIds,
    permissions,
    requestId: request.headers.get("x-request-id")?.slice(0, 200) || crypto.randomUUID(),
    authenticatedAt: session.principal.authenticatedAt ?? null,
    clock: systemClock,
  };
}

export function requirePermission(context: CommandContext, permission: string): void {
  if (!context.permissions.includes(permission)) {
    throw new ProductError("FORBIDDEN", `Missing required permission: ${permission}.`, 403);
  }
}

export async function upsertAuthenticatedProfile(
  principal: AuthenticatedPrincipal,
): Promise<void> {
  if (principal.type !== "user") return;
  const now = new Date().toISOString();
  await getDb()
    .insert(profiles)
    .values({
      id: principal.principalId,
      email: principal.email ?? `${principal.principalId}@unknown.commonstate`,
      displayName: principal.displayName,
      status: "active",
      lastSeenAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: profiles.id,
      set: { displayName: principal.displayName, lastSeenAt: now, updatedAt: now },
    });
}
