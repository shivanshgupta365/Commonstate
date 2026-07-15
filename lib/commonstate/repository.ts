import { and, asc, eq, sql } from "drizzle-orm";
import { tryGetDb, type CommonstateDb } from "../../db";
import {
  actors,
  agentRuns,
  approvals,
  claims,
  conflicts,
  contextPackEvidence,
  contextPacks,
  entities,
  evaluationResults,
  memoryEvents,
  outcomes,
  relationships,
  runEvents,
  scopes,
  sourceEvents,
  sources,
  workspaces,
} from "../../db/schema";
import {
  createSeedState,
  DEMO_NOW,
  DomainError,
  normalizeWorkspace,
  type DomainState,
  type StorageMeta,
} from "./domain";
import { withDeadline } from "./deadline";

export const WORKSPACE_OPEN_DEADLINE_MS = 1_250;

type DomainStore = {
  load(workspaceId: string): Promise<DomainState | null>;
  create(state: DomainState): Promise<void>;
  save(state: DomainState, expectedVersion: number): Promise<void>;
  reset(state: DomainState): Promise<void>;
};

export type WorkspaceSession = {
  state: DomainState;
  store: DomainStore;
  storage: StorageMeta;
};

function copied<T>(value: T): T {
  return structuredClone(value);
}

function castRows<T>(value: unknown): T {
  return value as T;
}

const temporalColumns = [
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
] as const;

function normalizeTemporalRecord<T>(value: T): T {
  const result = { ...(value as Record<string, unknown>) };
  for (const column of temporalColumns) {
    const timestamp = result[column];
    if (typeof timestamp === "string") result[column] = new Date(timestamp).toISOString();
  }
  return result as T;
}

function normalizeRows<T>(value: unknown): T {
  return (value as Array<Record<string, unknown>>).map(normalizeTemporalRecord) as T;
}

type TransactionDb = Parameters<Parameters<CommonstateDb["transaction"]>[0]>[0];

class PostgresDomainStore implements DomainStore {
  private readonly db: CommonstateDb;

  constructor(db: CommonstateDb) {
    this.db = db;
  }

  async load(workspaceId: string): Promise<DomainState | null> {
    const [workspace] = await this.db
      .select()
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId))
      .limit(1);
    if (!workspace) return null;

    const [
      scopeRows,
      actorRows,
      sourceRows,
      sourceEventRows,
      entityRows,
      relationshipRows,
      claimRows,
      memoryEventRows,
      conflictRows,
      approvalRows,
      contextPackRows,
      contextPackEvidenceRows,
      agentRunRows,
      runEventRows,
      outcomeRows,
      evaluationRows,
    ] = await Promise.all([
      this.db
        .select()
        .from(scopes)
        .where(eq(scopes.workspaceId, workspaceId))
        .orderBy(asc(scopes.createdAt), asc(scopes.id)),
      this.db
        .select()
        .from(actors)
        .where(eq(actors.workspaceId, workspaceId))
        .orderBy(asc(actors.createdAt), asc(actors.id)),
      this.db
        .select()
        .from(sources)
        .where(eq(sources.workspaceId, workspaceId))
        .orderBy(asc(sources.createdAt), asc(sources.id)),
      this.db
        .select()
        .from(sourceEvents)
        .where(eq(sourceEvents.workspaceId, workspaceId))
        .orderBy(asc(sourceEvents.createdAt), asc(sourceEvents.id)),
      this.db
        .select()
        .from(entities)
        .where(eq(entities.workspaceId, workspaceId))
        .orderBy(asc(entities.createdAt), asc(entities.id)),
      this.db
        .select()
        .from(relationships)
        .where(eq(relationships.workspaceId, workspaceId))
        .orderBy(asc(relationships.createdAt), asc(relationships.id)),
      this.db
        .select()
        .from(claims)
        .where(eq(claims.workspaceId, workspaceId))
        .orderBy(asc(claims.createdAt), asc(claims.id)),
      this.db
        .select()
        .from(memoryEvents)
        .where(eq(memoryEvents.workspaceId, workspaceId))
        .orderBy(asc(memoryEvents.sequence), asc(memoryEvents.id)),
      this.db
        .select()
        .from(conflicts)
        .where(eq(conflicts.workspaceId, workspaceId))
        .orderBy(asc(conflicts.createdAt), asc(conflicts.id)),
      this.db
        .select()
        .from(approvals)
        .where(eq(approvals.workspaceId, workspaceId))
        .orderBy(asc(approvals.createdAt), asc(approvals.id)),
      this.db
        .select()
        .from(contextPacks)
        .where(eq(contextPacks.workspaceId, workspaceId))
        .orderBy(asc(contextPacks.createdAt), asc(contextPacks.id)),
      this.db
        .select()
        .from(contextPackEvidence)
        .where(eq(contextPackEvidence.workspaceId, workspaceId))
        .orderBy(asc(contextPackEvidence.ordinal), asc(contextPackEvidence.id)),
      this.db
        .select()
        .from(agentRuns)
        .where(eq(agentRuns.workspaceId, workspaceId))
        .orderBy(asc(agentRuns.createdAt), asc(agentRuns.id)),
      this.db
        .select()
        .from(runEvents)
        .where(eq(runEvents.workspaceId, workspaceId))
        .orderBy(asc(runEvents.sequence), asc(runEvents.id)),
      this.db
        .select()
        .from(outcomes)
        .where(eq(outcomes.workspaceId, workspaceId))
        .orderBy(asc(outcomes.createdAt), asc(outcomes.id)),
      this.db
        .select()
        .from(evaluationResults)
        .where(eq(evaluationResults.workspaceId, workspaceId))
        .orderBy(
          asc(evaluationResults.runAt),
          asc(evaluationResults.category),
          asc(evaluationResults.caseName),
          asc(evaluationResults.id),
        ),
    ]);

    return {
      workspace: normalizeTemporalRecord(workspace),
      scopes: normalizeRows<DomainState["scopes"]>(scopeRows),
      actors: normalizeRows<DomainState["actors"]>(actorRows),
      sources: normalizeRows<DomainState["sources"]>(sourceRows),
      sourceEvents: normalizeRows<DomainState["sourceEvents"]>(sourceEventRows),
      entities: normalizeRows<DomainState["entities"]>(entityRows),
      relationships: normalizeRows<DomainState["relationships"]>(relationshipRows),
      claims: normalizeRows<DomainState["claims"]>(claimRows),
      memoryEvents: normalizeRows<DomainState["memoryEvents"]>(memoryEventRows).sort(
        (left, right) => left.sequence - right.sequence,
      ),
      conflicts: normalizeRows<DomainState["conflicts"]>(conflictRows),
      approvals: normalizeRows<DomainState["approvals"]>(approvalRows),
      contextPacks: normalizeRows<DomainState["contextPacks"]>(contextPackRows),
      contextPackEvidence: normalizeRows<DomainState["contextPackEvidence"]>(
        contextPackEvidenceRows,
      ),
      agentRuns: normalizeRows<DomainState["agentRuns"]>(agentRunRows),
      runEvents: normalizeRows<DomainState["runEvents"]>(runEventRows),
      outcomes: normalizeRows<DomainState["outcomes"]>(outcomeRows),
      evaluationResults: normalizeRows<DomainState["evaluationResults"]>(evaluationRows),
    };
  }

  async create(state: DomainState): Promise<void> {
    await this.db.transaction(async (tx) => {
      const inserted = await tx
        .insert(workspaces)
        .values(state.workspace)
        .onConflictDoNothing()
        .returning({ id: workspaces.id });
      if (inserted.length !== 1) throw concurrentUpdate();
      await this.persistRows(tx, state);
    });
  }

  async save(state: DomainState, expectedVersion: number): Promise<void> {
    await this.db.transaction(async (tx) => {
      await this.updateWorkspace(tx, state, expectedVersion);
      await this.persistRows(tx, state);
    });
  }

  private async updateWorkspace(
    tx: TransactionDb,
    state: DomainState,
    expectedVersion: number,
  ): Promise<void> {
    const updated = await tx
      .update(workspaces)
      .set({
        slug: state.workspace.slug,
        name: state.workspace.name,
        edition: state.workspace.edition,
        version: state.workspace.version,
        updatedAt: state.workspace.updatedAt,
      })
      .where(
        and(
          eq(workspaces.id, state.workspace.id),
          eq(workspaces.version, expectedVersion),
        ),
      )
      .returning({ id: workspaces.id });
    if (updated.length !== 1) throw concurrentUpdate();
  }

  private async persistRows(tx: TransactionDb, state: DomainState): Promise<void> {
    if (state.scopes.length) {
      await tx.insert(scopes).values(state.scopes).onConflictDoNothing();
    }
    if (state.actors.length) {
      await tx
        .insert(actors)
        .values(state.actors)
        .onConflictDoUpdate({
          target: actors.id,
          set: {
            displayName: sql`excluded.display_name`,
            role: sql`excluded.role`,
            permissions: sql`excluded.permissions`,
            writeBudget: sql`excluded.write_budget`,
            active: sql`excluded.active`,
            updatedAt: sql`excluded.updated_at`,
          },
        });
    }
    if (state.sources.length) {
      await tx.insert(sources).values(state.sources).onConflictDoNothing();
    }
    if (state.sourceEvents.length) {
      await tx.insert(sourceEvents).values(state.sourceEvents).onConflictDoNothing();
    }
    if (state.entities.length) {
      await tx
        .insert(entities)
        .values(state.entities)
        .onConflictDoUpdate({
          target: entities.id,
          set: {
            name: sql`excluded.name`,
            attributes: sql`excluded.attributes`,
            updatedAt: sql`excluded.updated_at`,
          },
        });
    }
    if (state.relationships.length) {
      await tx.insert(relationships).values(state.relationships).onConflictDoNothing();
    }
    if (state.claims.length) {
      await tx
        .insert(claims)
        .values(state.claims)
        .onConflictDoUpdate({
          target: claims.id,
          set: {
            lifecycle: sql`excluded.lifecycle`,
            supersedesClaimId: sql`excluded.supersedes_claim_id`,
            version: sql`excluded.version`,
            updatedAt: sql`excluded.updated_at`,
          },
        });
    }
    if (state.memoryEvents.length) {
      await tx.insert(memoryEvents).values(state.memoryEvents).onConflictDoNothing();
    }
    if (state.conflicts.length) {
      await tx
        .insert(conflicts)
        .values(state.conflicts)
        .onConflictDoUpdate({
          target: conflicts.id,
          set: {
            status: sql`excluded.status`,
            resolvedAt: sql`excluded.resolved_at`,
            resolutionClaimId: sql`excluded.resolution_claim_id`,
            updatedAt: sql`excluded.updated_at`,
          },
        });
    }
    if (state.approvals.length) {
      await tx.insert(approvals).values(state.approvals).onConflictDoNothing();
    }
    if (state.contextPacks.length) {
      await tx
        .insert(contextPacks)
        .values(state.contextPacks.map((row) => ({
          ...row,
          facts: castRows<Array<Record<string, unknown>>>(row.facts),
          citations: castRows<Array<Record<string, unknown>>>(row.citations),
        })))
        .onConflictDoUpdate({
          target: contextPacks.id,
          set: { invalidatedAt: sql`excluded.invalidated_at` },
        });
    }
    if (state.contextPackEvidence.length) {
      await tx
        .insert(contextPackEvidence)
        .values(state.contextPackEvidence)
        .onConflictDoNothing();
    }
    if (state.agentRuns.length) {
      await tx.insert(agentRuns).values(state.agentRuns).onConflictDoNothing();
    }
    if (state.runEvents.length) {
      await tx.insert(runEvents).values(state.runEvents).onConflictDoNothing();
    }
    if (state.outcomes.length) {
      await tx.insert(outcomes).values(state.outcomes).onConflictDoNothing();
    }
    if (state.evaluationResults.length) {
      await tx
        .insert(evaluationResults)
        .values(state.evaluationResults)
        .onConflictDoNothing();
    }
  }

  async reset(state: DomainState): Promise<void> {
    await this.db.transaction(async (tx) => {
      const workspaceId = state.workspace.id;
      await this.updateWorkspace(tx, state, state.workspace.version - 1);
      const tables = [
        evaluationResults,
        outcomes,
        runEvents,
        agentRuns,
        contextPackEvidence,
        contextPacks,
        approvals,
        conflicts,
        memoryEvents,
        claims,
        relationships,
        entities,
        sourceEvents,
        sources,
        actors,
        scopes,
      ] as const;
      for (const table of tables) {
        await tx.delete(table).where(eq(table.workspaceId, workspaceId));
      }
      await this.persistRows(tx, state);
    });
  }
}

function concurrentUpdate(): DomainError {
  return new DomainError(
    "CONCURRENT_UPDATE",
    "Workspace state changed while this command was running. Refresh and retry.",
    409,
  );
}

const memoryHost = globalThis as typeof globalThis & {
  __commonstateDemoWorkspaces?: Map<string, DomainState>;
};
const memoryWorkspaces =
  memoryHost.__commonstateDemoWorkspaces ??
  (memoryHost.__commonstateDemoWorkspaces = new Map<string, DomainState>());

class MemoryDomainStore implements DomainStore {
  async load(workspaceId: string): Promise<DomainState | null> {
    const state = memoryWorkspaces.get(workspaceId);
    return state ? copied(state) : null;
  }

  async create(state: DomainState): Promise<void> {
    if (!memoryWorkspaces.has(state.workspace.id)) {
      memoryWorkspaces.set(state.workspace.id, copied(state));
    }
  }

  async save(state: DomainState, expectedVersion: number): Promise<void> {
    const current = memoryWorkspaces.get(state.workspace.id);
    if (current && current.workspace.version !== expectedVersion) {
      throw new DomainError(
        "CONCURRENT_UPDATE",
        "Workspace state changed while this command was running. Refresh and retry.",
        409,
      );
    }
    memoryWorkspaces.set(state.workspace.id, copied(state));
  }

  async reset(state: DomainState): Promise<void> {
    memoryWorkspaces.set(state.workspace.id, copied(state));
  }
}

const memoryStore = new MemoryDomainStore();

function isCompleteWorkspaceState(state: DomainState): boolean {
  return (
    state.scopes.length >= 3 &&
    state.actors.length >= 3 &&
    state.sources.length >= 5 &&
    state.entities.length >= 7 &&
    state.claims.length >= 19 &&
    state.contextPacks.length >= 1 &&
    state.agentRuns.length >= 1 &&
    state.evaluationResults.length === 24 &&
    state.evaluationResults.every(
      (result) =>
        result.suite === "commonstate-domain-v2" &&
        result.details.executed === true &&
        result.details.fixtureVersion === "tano-demo-v2",
    )
  );
}

async function openFromPostgres(
  workspaceId: string,
  resolveDb: () => Promise<CommonstateDb | null>,
): Promise<WorkspaceSession | null> {
  const db = await resolveDb();
  if (!db) return null;

  const store = new PostgresDomainStore(db);
  let state = await store.load(workspaceId);
  if (!state) {
    state = await createSeedState(workspaceId);
    try {
      await store.create(state);
    } catch (error) {
      if (!(error instanceof DomainError) || error.code !== "CONCURRENT_UPDATE") {
        throw error;
      }
      const concurrentlyCreated = await store.load(workspaceId);
      if (!concurrentlyCreated) throw error;
      state = concurrentlyCreated;
    }
  } else if (!isCompleteWorkspaceState(state)) {
    throw storageUnavailable();
  }
  return {
    state,
    store,
    storage: { mode: "postgres", deterministic: true, notice: null },
  };
}

type WorkspaceOpenOptions = {
  deadlineMs?: number;
  resolveDb?: () => Promise<CommonstateDb | null>;
};

/** The options hook is intentionally narrow so tests can model stalled storage
 * resolver without weakening production workspace selection or store scope. */
export async function openWorkspace(
  workspaceValue: unknown,
  options: WorkspaceOpenOptions = {},
): Promise<WorkspaceSession> {
  const workspaceId = normalizeWorkspace(workspaceValue);
  const deadlineMs = options.deadlineMs ?? WORKSPACE_OPEN_DEADLINE_MS;
  let fallbackNotice = "Postgres is unavailable; local memory persistence is active.";
  try {
    const session = await withDeadline(
      () => openFromPostgres(workspaceId, options.resolveDb ?? tryGetDb),
      deadlineMs,
      "workspace storage open",
    );
    if (session) return session;
  } catch (error) {
    if (error instanceof DomainError && error.code === "CONCURRENT_UPDATE") throw error;
    fallbackNotice = `Postgres did not become available within the ${deadlineMs}ms workspace deadline; local memory persistence is active.`;
  }

  if (!canUseLocalMemory()) throw storageUnavailable();

  let state = await memoryStore.load(workspaceId);
  if (!state) {
    state = await createSeedState(workspaceId);
    await memoryStore.create(state);
  }
  return {
    state,
    store: memoryStore,
    storage: {
      mode: "memory-local",
      deterministic: true,
      notice: fallbackNotice,
    },
  };
}

export async function commitWorkspace(
  session: WorkspaceSession,
  nextState: DomainState,
): Promise<StorageMeta> {
  const expectedVersion = session.state.workspace.version;
  nextState.workspace.version = expectedVersion + 1;
  nextState.workspace.updatedAt = new Date(
    Date.parse(DEMO_NOW) + nextState.workspace.version * 3 * 60_000,
  ).toISOString();
  try {
    await session.store.save(nextState, expectedVersion);
    return session.storage;
  } catch (error) {
    if (error instanceof DomainError) throw error;
    if (!canUseLocalMemory()) throw storageUnavailable();
    await memoryStore.save(nextState, expectedVersion);
    return {
      mode: "memory-local",
      deterministic: true,
      notice: "The Postgres write failed locally; the isolated demo continued in process memory.",
    };
  }
}

export async function resetWorkspace(session: WorkspaceSession): Promise<{
  state: DomainState;
  storage: StorageMeta;
}> {
  const state = await createSeedState(session.state.workspace.id);
  state.workspace.version = session.state.workspace.version + 1;
  state.workspace.updatedAt = new Date(
    Date.parse(DEMO_NOW) + state.workspace.version * 3 * 60_000,
  ).toISOString();
  try {
    await session.store.reset(state);
    return { state, storage: session.storage };
  } catch (error) {
    if (error instanceof DomainError) throw error;
    if (!canUseLocalMemory()) throw storageUnavailable();
    await memoryStore.reset(state);
    return {
      state,
      storage: {
        mode: "memory-local",
        deterministic: true,
        notice: "Postgres reset was unavailable locally; process memory was reset instead.",
      },
    };
  }
}

function canUseLocalMemory(): boolean {
  return (
    process.env.NODE_ENV !== "production" ||
    process.env.COMMONSTATE_TEST_MEMORY === "1"
  );
}

function storageUnavailable(): DomainError {
  return new DomainError(
    "STORAGE_UNAVAILABLE",
    "Operational state storage is temporarily unavailable. Retry shortly or use the recorded demo.",
    503,
  );
}
