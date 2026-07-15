import { and, eq } from "drizzle-orm";
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

class D1DomainStore implements DomainStore {
  constructor(private readonly db: CommonstateDb) {}

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
      this.db.select().from(scopes).where(eq(scopes.workspaceId, workspaceId)),
      this.db.select().from(actors).where(eq(actors.workspaceId, workspaceId)),
      this.db.select().from(sources).where(eq(sources.workspaceId, workspaceId)),
      this.db.select().from(sourceEvents).where(eq(sourceEvents.workspaceId, workspaceId)),
      this.db.select().from(entities).where(eq(entities.workspaceId, workspaceId)),
      this.db.select().from(relationships).where(eq(relationships.workspaceId, workspaceId)),
      this.db.select().from(claims).where(eq(claims.workspaceId, workspaceId)),
      this.db.select().from(memoryEvents).where(eq(memoryEvents.workspaceId, workspaceId)),
      this.db.select().from(conflicts).where(eq(conflicts.workspaceId, workspaceId)),
      this.db.select().from(approvals).where(eq(approvals.workspaceId, workspaceId)),
      this.db.select().from(contextPacks).where(eq(contextPacks.workspaceId, workspaceId)),
      this.db
        .select()
        .from(contextPackEvidence)
        .where(eq(contextPackEvidence.workspaceId, workspaceId)),
      this.db.select().from(agentRuns).where(eq(agentRuns.workspaceId, workspaceId)),
      this.db.select().from(runEvents).where(eq(runEvents.workspaceId, workspaceId)),
      this.db.select().from(outcomes).where(eq(outcomes.workspaceId, workspaceId)),
      this.db
        .select()
        .from(evaluationResults)
        .where(eq(evaluationResults.workspaceId, workspaceId)),
    ]);

    return {
      workspace,
      scopes: castRows<DomainState["scopes"]>(scopeRows),
      actors: castRows<DomainState["actors"]>(actorRows),
      sources: castRows<DomainState["sources"]>(sourceRows),
      sourceEvents: castRows<DomainState["sourceEvents"]>(sourceEventRows),
      entities: castRows<DomainState["entities"]>(entityRows),
      relationships: castRows<DomainState["relationships"]>(relationshipRows),
      claims: castRows<DomainState["claims"]>(claimRows),
      memoryEvents: castRows<DomainState["memoryEvents"]>(memoryEventRows).sort(
        (left, right) => left.sequence - right.sequence,
      ),
      conflicts: castRows<DomainState["conflicts"]>(conflictRows),
      approvals: castRows<DomainState["approvals"]>(approvalRows),
      contextPacks: castRows<DomainState["contextPacks"]>(contextPackRows),
      contextPackEvidence: castRows<DomainState["contextPackEvidence"]>(
        contextPackEvidenceRows,
      ),
      agentRuns: castRows<DomainState["agentRuns"]>(agentRunRows),
      runEvents: castRows<DomainState["runEvents"]>(runEventRows),
      outcomes: castRows<DomainState["outcomes"]>(outcomeRows),
      evaluationResults: castRows<DomainState["evaluationResults"]>(evaluationRows),
    };
  }

  async create(state: DomainState): Promise<void> {
    await this.persist(state, null);
  }

  async save(state: DomainState, expectedVersion: number): Promise<void> {
    await this.persist(state, expectedVersion);
  }

  private async persist(state: DomainState, expectedVersion: number | null): Promise<void> {
    if (expectedVersion === null) {
      await this.db.insert(workspaces).values(state.workspace).onConflictDoNothing();
    } else {
      const updated = await this.db
        .update(workspaces)
        .set({
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
      if (updated.length !== 1) {
        throw new DomainError(
          "CONCURRENT_UPDATE",
          "Workspace state changed while this command was running. Refresh and retry.",
          409,
        );
      }
    }

    for (const row of state.scopes) {
      await this.db.insert(scopes).values(row).onConflictDoNothing();
    }
    for (const row of state.actors) {
      await this.db
        .insert(actors)
        .values(row)
        .onConflictDoUpdate({
          target: actors.id,
          set: {
            displayName: row.displayName,
            role: row.role,
            permissions: row.permissions,
            writeBudget: row.writeBudget,
            active: row.active,
            updatedAt: row.updatedAt,
          },
        });
    }
    for (const row of state.sources) {
      await this.db.insert(sources).values(row).onConflictDoNothing();
    }
    for (const row of state.sourceEvents) {
      await this.db.insert(sourceEvents).values(row).onConflictDoNothing();
    }
    for (const row of state.entities) {
      await this.db
        .insert(entities)
        .values(row)
        .onConflictDoUpdate({
          target: entities.id,
          set: { name: row.name, attributes: row.attributes, updatedAt: row.updatedAt },
        });
    }
    for (const row of state.relationships) {
      await this.db.insert(relationships).values(row).onConflictDoNothing();
    }
    for (const row of state.claims) {
      await this.db
        .insert(claims)
        .values(row)
        .onConflictDoUpdate({
          target: claims.id,
          set: {
            lifecycle: row.lifecycle,
            supersedesClaimId: row.supersedesClaimId,
            version: row.version,
            updatedAt: row.updatedAt,
          },
        });
    }
    for (const row of state.memoryEvents) {
      await this.db.insert(memoryEvents).values(row).onConflictDoNothing();
    }
    for (const row of state.conflicts) {
      await this.db
        .insert(conflicts)
        .values(row)
        .onConflictDoUpdate({
          target: conflicts.id,
          set: {
            status: row.status,
            resolvedAt: row.resolvedAt,
            resolutionClaimId: row.resolutionClaimId,
            updatedAt: row.updatedAt,
          },
        });
    }
    for (const row of state.approvals) {
      await this.db.insert(approvals).values(row).onConflictDoNothing();
    }
    for (const row of state.contextPacks) {
      await this.db
        .insert(contextPacks)
        .values({
          ...row,
          facts: castRows<Array<Record<string, unknown>>>(row.facts),
          citations: castRows<Array<Record<string, unknown>>>(row.citations),
        })
        .onConflictDoUpdate({
          target: contextPacks.id,
          set: { invalidatedAt: row.invalidatedAt },
        });
    }
    for (const row of state.contextPackEvidence) {
      await this.db.insert(contextPackEvidence).values(row).onConflictDoNothing();
    }
    for (const row of state.agentRuns) {
      await this.db.insert(agentRuns).values(row).onConflictDoNothing();
    }
    for (const row of state.runEvents) {
      await this.db.insert(runEvents).values(row).onConflictDoNothing();
    }
    for (const row of state.outcomes) {
      await this.db.insert(outcomes).values(row).onConflictDoNothing();
    }
    for (const row of state.evaluationResults) {
      await this.db.insert(evaluationResults).values(row).onConflictDoNothing();
    }
  }

  async reset(state: DomainState): Promise<void> {
    const workspaceId = state.workspace.id;
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
      await this.db.delete(table).where(eq(table.workspaceId, workspaceId));
    }
    await this.db.delete(workspaces).where(eq(workspaces.id, workspaceId));
    await this.create(state);
  }
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

export async function openWorkspace(workspaceValue: unknown): Promise<WorkspaceSession> {
  const workspaceId = normalizeWorkspace(workspaceValue);
  const db = await tryGetDb();
  if (db) {
    const store = new D1DomainStore(db);
    try {
      let state = await store.load(workspaceId);
      if (!state) {
        state = await createSeedState(workspaceId);
        await store.create(state);
      }
      return {
        state,
        store,
        storage: { mode: "d1", deterministic: true, notice: null },
      };
    } catch (error) {
      if (error instanceof DomainError && error.code === "CONCURRENT_UPDATE") throw error;
    }
  }

  let state = await memoryStore.load(workspaceId);
  if (!state) {
    state = await createSeedState(workspaceId);
    await memoryStore.create(state);
  }
  return {
    state,
    store: memoryStore,
    storage: {
      mode: "memory-fallback",
      deterministic: true,
      notice: "D1 is unavailable or not migrated; this isolated demo workspace is using in-memory persistence.",
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
    await memoryStore.save(nextState, expectedVersion);
    return {
      mode: "memory-fallback",
      deterministic: true,
      notice: "The D1 write failed safely; the isolated demo continued in memory for this Worker instance.",
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
  } catch {
    await memoryStore.reset(state);
    return {
      state,
      storage: {
        mode: "memory-fallback",
        deterministic: true,
        notice: "D1 reset was unavailable; the isolated in-memory demo workspace was reset instead.",
      },
    };
  }
}
