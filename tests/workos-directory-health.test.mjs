import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import { WorkOS } from "@workos-inc/node";

const { register } = await import("tsx/esm/api");
const unregister = register();
const {
  normalizeWorkosDirectoryEvent,
  persistWorkosDirectoryEvent,
  readRawWebhookBody,
  verifyWorkosWebhookPayload,
  workosDirectoryWebhook,
} = await import("../lib/product/workos-directory.ts");
const { healthReport } = await import("../lib/health.ts");

function directoryEvent(overrides = {}) {
  return {
    id: "event_dsync_test",
    event: "dsync.user.updated",
    createdAt: "2026-07-15T00:00:00.000Z",
    context: {},
    data: {
      object: "directory_user",
      id: "directory_user_test",
      directoryId: "directory_test",
      organizationId: "org_workos_test",
      rawAttributes: { excluded: "sensitive" },
      customAttributes: { excluded: "sensitive" },
      idpId: "idp_test",
      firstName: "Ada",
      lastName: "Lovelace",
      email: "Ada@Example.test",
      state: "inactive",
      createdAt: "2026-07-14T00:00:00.000Z",
      updatedAt: "2026-07-15T00:00:00.000Z",
      previousAttributes: { state: "active" },
    },
    ...overrides,
  };
}

test("Directory Sync normalization retains tenant-safe provisioning fields only", () => {
  const normalized = normalizeWorkosDirectoryEvent(directoryEvent());
  assert.ok(normalized);
  assert.equal(normalized.workosOrganizationId, "org_workos_test");
  assert.equal(normalized.directoryId, "directory_test");
  assert.equal(normalized.user.email, "ada@example.test");
  assert.equal(normalized.subjectState, "inactive");
  assert.equal(JSON.stringify(normalized).includes("sensitive"), false);
  assert.equal(
    normalizeWorkosDirectoryEvent({ ...directoryEvent(), event: "user.updated" }),
    null,
  );
});

test("WorkOS SDK verifies the exact raw body and signature", async () => {
  const secret = "whsec_directory_test_secret";
  const payload = JSON.stringify(directoryEvent());
  const timestamp = String(Date.now());
  const signature = await new WorkOS({ apiKey: "sk_test_webhook" }).webhooks.computeSignature(
    timestamp,
    payload,
    secret,
  );
  const verified = await verifyWorkosWebhookPayload(
    payload,
    `t=${timestamp}, v1=${signature}`,
    secret,
  );
  assert.equal(verified.id, "event_dsync_test");
  await assert.rejects(
    verifyWorkosWebhookPayload(`${payload} `, `t=${timestamp}, v1=${signature}`, secret),
    (error) => error?.code === "UNAUTHENTICATED",
  );
});

test("Webhook enforces signature and 64KB raw-body limit before persistence", async () => {
  const previous = process.env.WORKOS_WEBHOOK_SECRET;
  process.env.WORKOS_WEBHOOK_SECRET = "whsec_test";
  try {
    const missingSignature = await workosDirectoryWebhook(
      new Request("http://localhost/api/v1/webhooks/workos", {
        method: "POST",
        body: JSON.stringify(directoryEvent()),
      }),
    );
    assert.equal(missingSignature.status, 401);
    assert.equal((await missingSignature.json()).error.code, "UNAUTHENTICATED");

    await assert.rejects(
      readRawWebhookBody(
        new Request("http://localhost/api/v1/webhooks/workos", {
          method: "POST",
          headers: { "content-length": String(64 * 1024 + 1) },
          body: "{}",
        }),
      ),
      (error) => error?.code === "PAYLOAD_TOO_LARGE",
    );

    let persisted = null;
    const accepted = await workosDirectoryWebhook(
      new Request("http://localhost/api/v1/webhooks/workos?workspace=caller-choice", {
        method: "POST",
        headers: {
          "workos-signature": "test-signature",
          "x-workspace-id": "caller-choice",
        },
        body: JSON.stringify({ organizationId: "caller-choice" }),
      }),
      {
        constructEvent: async () => directoryEvent(),
        persistEvent: async (event, payloadHash) => {
          persisted = { event, payloadHash };
          return {
            eventId: event.eventId,
            duplicate: false,
            status: "queued",
            organizationMapped: true,
            queuedJobs: 1,
            revokedMemberships: 0,
            revokedServiceAccounts: 0,
          };
        },
      },
    );
    assert.equal(accepted.status, 200);
    assert.equal(persisted.event.workosOrganizationId, "org_workos_test");
    assert.equal(persisted.event.workosOrganizationId === "caller-choice", false);
    assert.match(persisted.payloadHash, /^[a-f0-9]{64}$/);
  } finally {
    if (previous === undefined) delete process.env.WORKOS_WEBHOOK_SECRET;
    else process.env.WORKOS_WEBHOOK_SECRET = previous;
  }
});

test("health report exposes readiness modes without configuration details", async () => {
  const hybrid = await healthReport(async () => ({
    source_chunks_ready: true,
    vector_enabled: true,
    vector_column: true,
  }));
  assert.equal(hybrid.status, "ready");
  assert.equal(hybrid.checks.retrieval.mode, "hybrid");
  const keyword = await healthReport(async () => ({
    source_chunks_ready: true,
    vector_enabled: false,
    vector_column: false,
  }));
  assert.equal(keyword.status, "ready");
  assert.equal(keyword.checks.retrieval.mode, "keyword");
  const unavailable = await healthReport(async () => {
    throw new Error("postgresql://secret@private.example/database");
  });
  assert.equal(unavailable.status, "unavailable");
  assert.equal(unavailable.checks.database.ready, false);
  assert.equal(JSON.stringify(unavailable).includes("private.example"), false);
});

test("Directory Sync persistence is idempotent and immediately revokes linked access", {
  skip: process.env.DATABASE_URL?.trim() ? false : "DATABASE_URL is not configured.",
  timeout: 30_000,
}, async () => {
  const database = await import("../db/index.ts");
  const schema = await import("../db/schema.ts");
  const { eq, sql } = await import("drizzle-orm");
  const suffix = `${Date.now().toString(36)}_${randomBytes(4).toString("hex")}`;
  const organizationId = `org_workos_${suffix}`;
  const workspaceId = `ws_workos_${suffix}`;
  const roleId = `role_workos_${suffix}`;
  const profileId = `profile_workos_${suffix}`;
  const membershipId = `membership_workos_${suffix}`;
  const serviceAccountId = `sa_workos_${suffix}`;
  const workosOrganizationId = `org_workos_external_${suffix}`;
  const directoryId = `directory_${suffix}`;
  const externalUserId = `directory_user_${suffix}`;
  const timestamp = new Date().toISOString();
  const db = database.getDb();

  try {
    await db.insert(schema.organizations).values({
      id: organizationId,
      slug: `workos-${suffix}`,
      name: "WorkOS integration test",
      metadata: { workosOrganizationId },
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    await db.insert(schema.workspaces).values({
      id: workspaceId,
      organizationId,
      slug: `workos-workspace-${suffix}`,
      name: "WorkOS workspace",
      edition: "ai-operations",
      kind: "production",
      status: "active",
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    await db.insert(schema.roles).values({
      id: roleId,
      organizationId,
      workspaceId,
      roleKey: "directory-member",
      name: "Directory member",
      permissions: ["workspace:read"],
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    await db.insert(schema.profiles).values({
      id: profileId,
      email: `${suffix}@example.test`,
      displayName: "Directory user",
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    await db.insert(schema.memberships).values({
      id: membershipId,
      organizationId,
      workspaceId,
      profileId,
      roleId,
      status: "active",
      provisionedBy: "workos_directory",
      externalRef: externalUserId,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    await db.insert(schema.serviceAccounts).values({
      id: serviceAccountId,
      organizationId,
      workspaceId,
      roleId,
      name: "Linked automation identity",
      keyPrefix: `cs_sa_${suffix}`,
      secretHash: "0".repeat(64),
      permissions: ["workspace:read"],
      allowedScopeIds: [],
      active: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    await db.execute(sql`
      insert into directory_principal_links (
        id, organization_id, workspace_id, directory_id, external_user_id,
        principal_type, principal_id
      ) values (
        ${`link_user_${suffix}`}, ${organizationId}, ${workspaceId}, ${directoryId},
        ${externalUserId}, 'user', ${profileId}
      ), (
        ${`link_service_${suffix}`}, ${organizationId}, ${workspaceId}, ${directoryId},
        ${externalUserId}, 'service_account', ${serviceAccountId}
      )
    `);
    const normalized = normalizeWorkosDirectoryEvent(
      directoryEvent({
        id: `event_workos_${suffix}`,
        data: {
          ...directoryEvent().data,
          id: externalUserId,
          directoryId,
          organizationId: workosOrganizationId,
          email: `${suffix}@example.test`,
        },
      }),
    );
    assert.ok(normalized);
    const first = await persistWorkosDirectoryEvent(normalized, "a".repeat(64));
    assert.equal(first.duplicate, false);
    assert.equal(first.status, "processed");
    assert.equal(first.revokedMemberships, 1);
    assert.equal(first.revokedServiceAccounts, 1);
    const duplicate = await persistWorkosDirectoryEvent(normalized, "a".repeat(64));
    assert.equal(duplicate.duplicate, true);
    assert.equal(duplicate.revokedMemberships, 1);
    await assert.rejects(
      persistWorkosDirectoryEvent(normalized, "b".repeat(64)),
      (error) => error?.code === "CONFLICT",
    );

    const queuedEvent = normalizeWorkosDirectoryEvent(
      directoryEvent({
        id: `event_workos_queue_${suffix}`,
        event: "dsync.user.created",
        data: {
          ...directoryEvent().data,
          id: `new_${externalUserId}`,
          directoryId,
          organizationId: workosOrganizationId,
          state: "active",
        },
      }),
    );
    assert.ok(queuedEvent);
    const queued = await persistWorkosDirectoryEvent(queuedEvent, "c".repeat(64));
    assert.equal(queued.status, "queued");
    assert.equal(queued.queuedJobs, 1);
    assert.equal((await persistWorkosDirectoryEvent(queuedEvent, "c".repeat(64))).duplicate, true);

    const [membership] = await db
      .select({ status: schema.memberships.status })
      .from(schema.memberships)
      .where(eq(schema.memberships.id, membershipId));
    const [account] = await db
      .select({ active: schema.serviceAccounts.active })
      .from(schema.serviceAccounts)
      .where(eq(schema.serviceAccounts.id, serviceAccountId));
    assert.equal(membership.status, "revoked");
    assert.equal(account.active, false);
    const auditRows = await db.execute(sql`
      select resource_type from audit_events
      where request_id = ${normalized.eventId}
      order by resource_type
    `);
    assert.deepEqual(
      auditRows.map((row) => row.resource_type),
      ["membership", "service_account"],
    );
    const jobRows = await db.execute(sql`
      select id from jobs where idempotency_key = ${`workos:${queuedEvent.eventId}`}
    `);
    assert.equal(jobRows.length, 1);
  } finally {
    await db.delete(schema.auditEvents).where(eq(schema.auditEvents.organizationId, organizationId));
    await db.delete(schema.organizations).where(eq(schema.organizations.id, organizationId));
    await database.closeDb();
  }
});

test.after(() => unregister());
