import { createHash } from "node:crypto";
import { WorkOS, type Event } from "@workos-inc/node";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "../../db";
import {
  memberships,
  organizations,
  profiles,
  serviceAccounts,
  workspaces,
} from "../../db/schema";
import { ProductError, isDatabaseUnavailable } from "./errors";
import { productFailure, productSuccess, requestId } from "./http";

const MAX_WEBHOOK_BYTES = 64 * 1024;
const WORKOS_SIGNATURE_HEADER = "workos-signature";

type UnknownRecord = Record<string, unknown>;

export type NormalizedDirectoryEvent = Readonly<{
  eventId: string;
  eventType: string;
  occurredAt: string;
  workosOrganizationId: string | null;
  directoryId: string | null;
  subjectType: "directory" | "group" | "user" | "group_membership";
  externalSubjectId: string | null;
  subjectState: string | null;
  user: Readonly<{
    id: string;
    directoryId: string;
    organizationId: string | null;
    email: string | null;
    firstName: string | null;
    lastName: string | null;
    state: string | null;
  }> | null;
  group: Readonly<{ id: string; directoryId: string; name: string | null }> | null;
}>;

export type DirectoryEventResult = Readonly<{
  eventId: string;
  duplicate: boolean;
  status: "queued" | "queued_unmapped" | "processed";
  organizationMapped: boolean;
  queuedJobs: number;
  revokedMemberships: number;
  revokedServiceAccounts: number;
}>;

type WebhookDependencies = Readonly<{
  constructEvent?: (payload: string, signature: string, secret: string) => Promise<Event>;
  persistEvent?: (
    normalized: NormalizedDirectoryEvent,
    payloadHash: string,
  ) => Promise<DirectoryEventResult>;
}>;

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizedUser(value: unknown): NormalizedDirectoryEvent["user"] {
  const user = record(value);
  const id = stringOrNull(user.id);
  const directoryId = stringOrNull(user.directoryId);
  if (!id || !directoryId) return null;
  return Object.freeze({
    id,
    directoryId,
    organizationId: stringOrNull(user.organizationId),
    email: stringOrNull(user.email)?.toLowerCase() ?? null,
    firstName: stringOrNull(user.firstName),
    lastName: stringOrNull(user.lastName),
    state: stringOrNull(user.state),
  });
}

function normalizedGroup(value: unknown): NormalizedDirectoryEvent["group"] {
  const group = record(value);
  const id = stringOrNull(group.id);
  const directoryId = stringOrNull(group.directoryId);
  if (!id || !directoryId) return null;
  return Object.freeze({ id, directoryId, name: stringOrNull(group.name) });
}

/**
 * Reduce a verified WorkOS event to the fields required for provisioning and
 * revocation. Raw/custom directory attributes are intentionally not persisted.
 */
export function normalizeWorkosDirectoryEvent(event: Event): NormalizedDirectoryEvent | null {
  if (!event.event.startsWith("dsync.")) return null;
  const data = record(event.data);
  const membershipEvent =
    event.event === "dsync.group.user_added" || event.event === "dsync.group.user_removed";
  const user = normalizedUser(membershipEvent ? data.user : data);
  const group = normalizedGroup(membershipEvent ? data.group : data);
  const directoryId =
    user?.directoryId ??
    group?.directoryId ??
    stringOrNull(data.directoryId) ??
    (event.event === "dsync.activated" || event.event === "dsync.deleted"
      ? stringOrNull(data.id)
      : null);
  const workosOrganizationId =
    user?.organizationId ?? stringOrNull(data.organizationId) ?? stringOrNull(record(data.user).organizationId);
  const subjectType = event.event.startsWith("dsync.user.")
    ? "user"
    : event.event.startsWith("dsync.group.user_")
      ? "group_membership"
      : event.event.startsWith("dsync.group.")
        ? "group"
        : "directory";
  const externalSubjectId =
    subjectType === "user"
      ? user?.id ?? null
      : subjectType === "group"
        ? group?.id ?? null
        : subjectType === "group_membership"
          ? user?.id ?? null
          : stringOrNull(data.id);

  return Object.freeze({
    eventId: event.id,
    eventType: event.event,
    occurredAt: event.createdAt,
    workosOrganizationId,
    directoryId,
    subjectType,
    externalSubjectId,
    subjectState: user?.state ?? stringOrNull(data.state),
    user,
    group,
  });
}

export async function readRawWebhookBody(request: Request): Promise<string> {
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_WEBHOOK_BYTES) {
    throw new ProductError("PAYLOAD_TOO_LARGE", "Webhook body must be 64KB or smaller.", 413);
  }
  const payload = await request.text();
  if (new TextEncoder().encode(payload).byteLength > MAX_WEBHOOK_BYTES) {
    throw new ProductError("PAYLOAD_TOO_LARGE", "Webhook body must be 64KB or smaller.", 413);
  }
  return payload;
}

export async function verifyWorkosWebhookPayload(
  payload: string,
  signature: string,
  secret: string,
): Promise<Event> {
  // Signature verification is local cryptography and does not call the WorkOS
  // API. The SDK still requires a constructor credential, so webhook-only
  // deployments use a non-secret sentinel when no API client is configured.
  const workos = new WorkOS({
    apiKey: process.env.WORKOS_API_KEY?.trim() || "sk_webhook_verification_only",
  });
  try {
    return await workos.webhooks.constructEvent({
      payload,
      sigHeader: signature,
      secret,
    });
  } catch {
    throw new ProductError("UNAUTHENTICATED", "WorkOS webhook signature is invalid.", 401);
  }
}

function requiresImmediateRevocation(event: NormalizedDirectoryEvent): boolean {
  return (
    event.eventType === "dsync.user.deleted" ||
    (event.eventType === "dsync.user.updated" && event.subjectState === "inactive")
  );
}

function json(value: unknown): string {
  return JSON.stringify(value);
}

function deterministicJobId(workspaceId: string, eventId: string): string {
  return `job_workos_${createHash("sha256").update(`${workspaceId}:${eventId}`).digest("hex").slice(0, 32)}`;
}

/**
 * Persist a verified event without accepting organization/workspace input from
 * the request. The only mapping is signed WorkOS organization ID -> stored
 * organizations.metadata.workosOrganizationId.
 */
export async function persistWorkosDirectoryEvent(
  event: NormalizedDirectoryEvent,
  payloadHash: string,
): Promise<DirectoryEventResult> {
  try {
    return await getDb().transaction(async (tx) => {
      const organizationRows = event.workosOrganizationId
        ? await tx
            .select({ id: organizations.id })
            .from(organizations)
            .where(
              sql`${organizations.metadata} ->> 'workosOrganizationId' = ${event.workosOrganizationId}`,
            )
            .orderBy(asc(organizations.id))
            .limit(2)
        : [];
      // Ambiguous mappings fail closed. The migration's partial unique index
      // prevents this state for newly configured organizations.
      const organizationId = organizationRows.length === 1 ? organizationRows[0].id : null;
      const insert = await tx.execute(sql`
        insert into directory_sync_events (
          event_id, workos_organization_id, organization_id, event_type,
          directory_id, external_subject_id, subject_type, subject_state,
          payload_hash, normalized_payload, status, occurred_at
        ) values (
          ${event.eventId}, ${event.workosOrganizationId}, ${organizationId}, ${event.eventType},
          ${event.directoryId}, ${event.externalSubjectId}, ${event.subjectType}, ${event.subjectState},
          ${payloadHash}, ${json(event)}::jsonb,
          ${organizationId ? "queued" : "queued_unmapped"}, ${event.occurredAt}::timestamptz
        )
        on conflict (event_id) do nothing
        returning event_id
      `);
      if (insert.length === 0) {
        const existing = await tx.execute(sql`
          select status, organization_id, processing_result, payload_hash
          from directory_sync_events where event_id = ${event.eventId} limit 1
        `);
        const row = (existing as unknown as UnknownRecord[])[0] ?? {};
        if (row.payload_hash !== payloadHash) {
          throw new ProductError(
            "CONFLICT",
            "A WorkOS event with this ID was already recorded with a different payload.",
            409,
          );
        }
        const result = record(row.processing_result);
        return Object.freeze({
          eventId: event.eventId,
          duplicate: true,
          status:
            row.status === "processed"
              ? "processed"
              : row.status === "queued_unmapped"
                ? "queued_unmapped"
                : "queued",
          organizationMapped: typeof row.organization_id === "string",
          queuedJobs: Number(result.queuedJobs ?? 0),
          revokedMemberships: Number(result.revokedMemberships ?? 0),
          revokedServiceAccounts: Number(result.revokedServiceAccounts ?? 0),
        });
      }

      let revokedMemberships = 0;
      let revokedServiceAccounts = 0;
      const revokedResources: Array<{
        workspaceId: string;
        resourceType: "membership" | "service_account";
        resourceId: string;
      }> = [];
      let queuedJobs = 0;
      let status: DirectoryEventResult["status"] = organizationId ? "queued" : "queued_unmapped";

      if (
        organizationId &&
        event.directoryId &&
        event.user &&
        requiresImmediateRevocation(event)
      ) {
        const links = (await tx.execute(sql`
          select principal_type, principal_id
          from directory_principal_links
          where organization_id = ${organizationId}
            and directory_id = ${event.directoryId}
            and external_user_id = ${event.user.id}
            and active = true
          order by principal_type, principal_id
        `)) as unknown as UnknownRecord[];
        const linkedProfileIds = links
          .filter((row) => row.principal_type === "user" && typeof row.principal_id === "string")
          .map((row) => row.principal_id as string);
        const linkedServiceAccountIds = links
          .filter(
            (row) =>
              row.principal_type === "service_account" && typeof row.principal_id === "string",
          )
          .map((row) => row.principal_id as string);

        const directMemberships = await tx
          .select({ profileId: memberships.profileId })
          .from(memberships)
          .where(
            and(
              eq(memberships.organizationId, organizationId),
              eq(memberships.provisionedBy, "workos_directory"),
              eq(memberships.externalRef, event.user.id),
              eq(memberships.status, "active"),
            ),
          )
          .orderBy(asc(memberships.profileId));
        const profileIds = new Set([
          ...linkedProfileIds,
          ...directMemberships.map((membership) => membership.profileId),
        ]);

        // Email fallback is permitted only for exactly one active WorkOS-
        // provisioned profile in this organization, avoiding shared-email or
        // caller-controlled identity matching.
        if (profileIds.size === 0 && event.user.email) {
          const emailMatches = await tx
            .select({ profileId: profiles.id })
            .from(memberships)
            .innerJoin(profiles, eq(profiles.id, memberships.profileId))
            .where(
              and(
                eq(memberships.organizationId, organizationId),
                eq(memberships.provisionedBy, "workos_directory"),
                eq(memberships.status, "active"),
                sql`lower(${profiles.email}) = ${event.user.email}`,
              ),
            )
            .orderBy(asc(profiles.id))
            .limit(2);
          if (emailMatches.length === 1) profileIds.add(emailMatches[0].profileId);
        }

        if (profileIds.size > 0) {
          const updated = await tx
            .update(memberships)
            .set({ status: "revoked", updatedAt: new Date().toISOString() })
            .where(
              and(
                eq(memberships.organizationId, organizationId),
                eq(memberships.status, "active"),
                inArray(memberships.profileId, [...profileIds]),
              ),
            )
            .returning({ id: memberships.id, workspaceId: memberships.workspaceId });
          revokedMemberships = updated.length;
          revokedResources.push(
            ...updated.map((row) => ({
              workspaceId: row.workspaceId,
              resourceType: "membership" as const,
              resourceId: row.id,
            })),
          );
        }
        if (linkedServiceAccountIds.length > 0) {
          const updated = await tx
            .update(serviceAccounts)
            .set({ active: false, updatedAt: new Date().toISOString() })
            .where(
              and(
                eq(serviceAccounts.organizationId, organizationId),
                eq(serviceAccounts.active, true),
                inArray(serviceAccounts.id, linkedServiceAccountIds),
              ),
            )
            .returning({ id: serviceAccounts.id, workspaceId: serviceAccounts.workspaceId });
          revokedServiceAccounts = updated.length;
          revokedResources.push(
            ...updated.map((row) => ({
              workspaceId: row.workspaceId,
              resourceType: "service_account" as const,
              resourceId: row.id,
            })),
          );
        }
        if (revokedMemberships > 0 || revokedServiceAccounts > 0) {
          status = "processed";
          await tx.execute(sql`
            update directory_principal_links
            set active = false, updated_at = now()
            where organization_id = ${organizationId}
              and directory_id = ${event.directoryId}
              and external_user_id = ${event.user.id}
              and active = true
          `);
          for (const resource of revokedResources) {
            const auditSeed = `${event.eventId}:${resource.resourceType}:${resource.resourceId}`;
            await tx.execute(sql`
              insert into audit_events (
                id, organization_id, workspace_id, request_id, principal_type,
                principal_id, action, resource_type, resource_id, policy_decision,
                before_hash, after_hash, metadata
              ) values (
                ${`audit_workos_${createHash("sha256").update(auditSeed).digest("hex").slice(0, 32)}`},
                ${organizationId}, ${resource.workspaceId}, ${event.eventId}, 'system',
                'system:workos-directory-webhook', 'directory_identity.revoke',
                ${resource.resourceType}, ${resource.resourceId}, 'required_immediate',
                ${createHash("sha256").update(`${resource.resourceId}:active`).digest("hex")},
                ${createHash("sha256").update(`${resource.resourceId}:revoked`).digest("hex")},
                ${json({ eventType: event.eventType, directoryId: event.directoryId })}::jsonb
              )
              on conflict (workspace_id, request_id, action, resource_id) do nothing
            `);
          }
        }
      }

      if (organizationId && status !== "processed") {
        const workspaceRows = await tx
          .select({ id: workspaces.id })
          .from(workspaces)
          .where(and(eq(workspaces.organizationId, organizationId), eq(workspaces.status, "active")))
          .orderBy(asc(workspaces.createdAt), asc(workspaces.id));
        for (const workspace of workspaceRows) {
          const job = await tx.execute(sql`
            insert into jobs (
              id, organization_id, workspace_id, job_type, status,
              idempotency_key, payload, attempts, max_attempts, run_after
            ) values (
              ${deterministicJobId(workspace.id, event.eventId)}, ${organizationId}, ${workspace.id},
              'workos.directory.sync', 'queued', ${`workos:${event.eventId}`},
              ${json(event)}::jsonb, 0, 5, now()
            )
            on conflict (workspace_id, idempotency_key) do nothing
            returning id
          `);
          queuedJobs += job.length;
        }
      }

      const processingResult = { queuedJobs, revokedMemberships, revokedServiceAccounts };
      await tx.execute(sql`
        update directory_sync_events
        set status = ${status},
            processing_result = ${json(processingResult)}::jsonb,
            processed_at = case when ${status} = 'processed' then now() else null end,
            updated_at = now()
        where event_id = ${event.eventId}
      `);
      return Object.freeze({
        eventId: event.eventId,
        duplicate: false,
        status,
        organizationMapped: Boolean(organizationId),
        queuedJobs,
        revokedMemberships,
        revokedServiceAccounts,
      });
    });
  } catch (error) {
    if (isDatabaseUnavailable(error)) {
      throw new ProductError("STORAGE_UNAVAILABLE", "PostgreSQL storage is unavailable.", 503);
    }
    throw error;
  }
}

export async function workosDirectoryWebhook(
  request: Request,
  dependencies: WebhookDependencies = {},
): Promise<Response> {
  const id = requestId(request);
  try {
    const secret = process.env.WORKOS_WEBHOOK_SECRET?.trim();
    if (!secret) {
      throw new ProductError(
        "CONNECTOR_UNAVAILABLE",
        "WorkOS Directory Sync webhook verification is not configured.",
        503,
      );
    }
    const signature = request.headers.get(WORKOS_SIGNATURE_HEADER)?.trim();
    if (!signature) {
      throw new ProductError("UNAUTHENTICATED", "WorkOS webhook signature is required.", 401);
    }
    const payload = await readRawWebhookBody(request);
    const constructEvent = dependencies.constructEvent ?? verifyWorkosWebhookPayload;
    const verified = await constructEvent(payload, signature, secret);
    const normalized = normalizeWorkosDirectoryEvent(verified);
    if (!normalized) {
      return productSuccess(id, { accepted: false, reason: "unsupported_event" }, 202);
    }
    const payloadHash = createHash("sha256").update(payload).digest("hex");
    const persistEvent = dependencies.persistEvent ?? persistWorkosDirectoryEvent;
    const result = await persistEvent(normalized, payloadHash);
    return productSuccess(id, { accepted: true, ...result });
  } catch (error) {
    return productFailure(error, id);
  }
}
