import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";

const databaseUrl = process.env.DATABASE_URL?.trim();
const skipReason = databaseUrl
  ? false
  : "DATABASE_URL is not configured; PostgreSQL repository integration is skipped.";

const timestampFields = [
  "createdAt",
  "updatedAt",
  "capturedAt",
  "observedAt",
  "validFrom",
  "validTo",
  "detectedAt",
  "resolvedAt",
  "asOf",
  "invalidatedAt",
  "startedAt",
  "completedAt",
  "runAt",
];

const stateCollections = [
  "scopes",
  "actors",
  "sources",
  "sourceEvents",
  "entities",
  "relationships",
  "claims",
  "memoryEvents",
  "conflicts",
  "approvals",
  "contextPacks",
  "contextPackEvidence",
  "agentRuns",
  "runEvents",
  "outcomes",
  "evaluationResults",
];

function timestampSnapshot(state) {
  const entries = [];
  const records = [["workspace", state.workspace], ...stateCollections.flatMap((collection) =>
    state[collection].map((record) => [collection, record]))];
  for (const [collection, record] of records) {
    for (const field of timestampFields) {
      if (record[field] !== undefined) {
        entries.push([`${collection}:${record.id}:${field}`, record[field]]);
      }
    }
  }
  return Object.fromEntries(entries.sort(([left], [right]) => left.localeCompare(right)));
}

function hashSnapshot(state) {
  return Object.fromEntries(
    [
      ...state.sources.map((source) => [`source:${source.id}`, source.sha256]),
      ...state.contextPacks.map((pack) => [`context:${pack.id}`, pack.versionHash]),
      ...state.agentRuns.flatMap((run) => [
        [`run-context:${run.id}`, run.contextVersionHash],
        [`run-receipt:${run.id}`, run.receiptHash],
      ]),
      ...state.outcomes.map((outcome) => [`outcome:${outcome.id}`, outcome.receiptHash]),
    ].sort(([left], [right]) => left.localeCompare(right)),
  );
}

test("PostgresDomainStore preserves the complete deterministic workspace lifecycle", {
  skip: skipReason,
  timeout: 30_000,
}, async (context) => {
  const { register } = await import("tsx/esm/api");
  const unregister = register();
  const [{ eq }, database, schema, domain, repository] = await Promise.all([
    import("drizzle-orm"),
    import("../db/index.ts"),
    import("../db/schema.ts"),
    import("../lib/commonstate/domain.ts"),
    import("../lib/commonstate/repository.ts"),
  ]);

  const workspaceId = [
    "pg-integration",
    process.pid.toString(36),
    Date.now().toString(36),
    randomBytes(4).toString("hex"),
  ].join("-");
  const db = database.getDb();

  try {
    // The database is shared safely: only this unique workspace is cleared.
    await db.delete(schema.workspaces).where(eq(schema.workspaces.id, workspaceId));

    await context.test("seeds and reloads a blank workspace with exact evidence", async () => {
      const expected = await domain.createSeedState(workspaceId);
      const seeded = await repository.openWorkspace(workspaceId);
      assert.equal(seeded.storage.mode, "postgres");
      assert.equal(seeded.state.evaluationResults.length, 24);
      assert.ok(seeded.state.evaluationResults.every((result) => result.passed));

      const loaded = await repository.openWorkspace(workspaceId);
      assert.equal(loaded.state.workspace.version, 1);
      assert.equal(loaded.state.evaluationResults.length, 24);
      assert.deepEqual(timestampSnapshot(loaded.state), timestampSnapshot(expected));
      assert.deepEqual(hashSnapshot(loaded.state), hashSnapshot(expected));
    });

    const winnerInput = {
      idempotencyKey: `${workspaceId}-winner`,
      text:
        "Synthetic Slack update: Use a supportive, low-pressure rebrief. Amara's paid usage now ends 18 July and her revised hook is still unresolved. Winner transaction.",
    };
    const loserInput = {
      idempotencyKey: `${workspaceId}-loser`,
      text:
        "Synthetic Slack update: Amara's paid usage now ends 18 July and her revised hook is still unresolved. Loser transaction must roll back.",
    };

    await context.test("commits a complete mutation and reloads it atomically", async () => {
      const session = await repository.openWorkspace(workspaceId);
      const mutation = await domain.ingestUpdate(session.state, winnerInput);
      assert.equal(mutation.changed, true);
      await repository.commitWorkspace(session, mutation.state);

      const loaded = await repository.openWorkspace(workspaceId);
      const winnerEvent = loaded.state.sourceEvents.find(
        (event) => event.idempotencyKey === winnerInput.idempotencyKey,
      );
      assert.equal(loaded.state.workspace.version, 2);
      assert.ok(winnerEvent);
      assert.equal(
        loaded.state.claims.filter((claim) => claim.sourceEventId === winnerEvent.id).length,
        3,
      );
      assert.equal(
        loaded.state.conflicts.filter((conflict) =>
          loaded.state.claims.some(
            (claim) =>
              claim.sourceEventId === winnerEvent.id &&
              conflict.rightClaimId === claim.id,
          )).length,
        3,
      );
      assert.ok(loaded.state.contextPacks.some((pack) => pack.invalidatedAt !== null));
    });

    await context.test("treats duplicate ingestion as an idempotent no-op", async () => {
      const before = await repository.openWorkspace(workspaceId);
      const duplicate = await domain.ingestUpdate(before.state, winnerInput);
      assert.equal(duplicate.changed, false);
      assert.equal(duplicate.result.duplicate, true);

      const after = await repository.openWorkspace(workspaceId);
      assert.equal(after.state.workspace.version, before.state.workspace.version);
      assert.equal(
        after.state.sourceEvents.filter(
          (event) => event.idempotencyKey === winnerInput.idempotencyKey,
        ).length,
        1,
      );
    });

    await context.test("rejects stale CAS without leaking a partial write", async () => {
      const winner = await repository.openWorkspace(workspaceId);
      const stale = await repository.openWorkspace(workspaceId);
      const nextWinner = await domain.ingestUpdate(winner.state, {
        ...winnerInput,
        idempotencyKey: `${workspaceId}-cas-winner`,
        text: `${winnerInput.text} CAS winner.`,
      });
      await repository.commitWorkspace(winner, nextWinner.state);

      const staleMutation = await domain.ingestUpdate(stale.state, loserInput);
      const staleEvent = staleMutation.state.sourceEvents.find(
        (event) => event.idempotencyKey === loserInput.idempotencyKey,
      );
      assert.ok(staleEvent);
      await assert.rejects(
        repository.commitWorkspace(stale, staleMutation.state),
        (error) =>
          error instanceof domain.DomainError &&
          error.code === "CONCURRENT_UPDATE" &&
          error.status === 409,
      );

      const loaded = await repository.openWorkspace(workspaceId);
      assert.equal(loaded.state.workspace.version, 3);
      assert.equal(
        loaded.state.sourceEvents.some(
          (event) => event.idempotencyKey === loserInput.idempotencyKey,
        ),
        false,
      );
      assert.equal(
        loaded.state.sources.some((source) => source.id === staleEvent.sourceId),
        false,
      );
      assert.equal(
        loaded.state.claims.some((claim) => claim.sourceEventId === staleEvent.id),
        false,
      );
    });

    await context.test("resets only the selected workspace to its deterministic seed", async () => {
      const current = await repository.openWorkspace(workspaceId);
      const reset = await repository.resetWorkspace(current);
      assert.equal(reset.storage.mode, "postgres");
      assert.equal(reset.state.workspace.version, current.state.workspace.version + 1);

      const loaded = await repository.openWorkspace(workspaceId);
      const expected = await domain.createSeedState(workspaceId);
      assert.equal(loaded.state.workspace.version, reset.state.workspace.version);
      assert.equal(loaded.state.sourceEvents.length, 0);
      assert.equal(loaded.state.evaluationResults.length, 24);
      assert.deepEqual(hashSnapshot(loaded.state), hashSnapshot(expected));
      assert.deepEqual(
        timestampSnapshot({ ...loaded.state, workspace: expected.workspace }),
        timestampSnapshot(expected),
      );
    });
  } finally {
    await db.delete(schema.workspaces).where(eq(schema.workspaces.id, workspaceId));
    await database.closeDb();
    unregister();
  }
});
