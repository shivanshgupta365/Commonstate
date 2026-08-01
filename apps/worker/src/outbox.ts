/**
 * Transactional outbox worker primitives.
 *
 * Postgres claims one due job with `FOR UPDATE SKIP LOCKED`; handlers remain
 * provider-neutral and receive cancellation state through the repository.
 */

export type OutboxJobStatus =
  | "queued"
  | "processing"
  | "retry"
  | "completed"
  | "dead_letter"
  | "cancelled";

export type OutboxJob = Readonly<{
  id: string;
  organizationId: string;
  workspaceId: string;
  jobType: string;
  idempotencyKey: string;
  payload: Readonly<Record<string, unknown>>;
  status: OutboxJobStatus;
  attempts: number;
  maxAttempts: number;
  availableAt: string;
  lockedAt: string | null;
  lockedBy: string | null;
  cancelRequestedAt: string | null;
  completedAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}>;

export type EnqueueOutboxJob = Readonly<{
  id: string;
  organizationId: string;
  workspaceId: string;
  jobType: string;
  idempotencyKey: string;
  payload: Readonly<Record<string, unknown>>;
  maxAttempts: number;
  availableAt: string;
  createdAt: string;
}>;

export interface OutboxRepository {
  enqueue(job: EnqueueOutboxJob): Promise<Readonly<{ job: OutboxJob; duplicate: boolean }>>;
  get(jobId: string): Promise<OutboxJob | null>;
  claimNext(workerId: string, now: string, supportedJobTypes?: readonly string[]): Promise<OutboxJob | null>;
  complete(jobId: string, workerId: string, now: string): Promise<void>;
  retry(jobId: string, workerId: string, availableAt: string, error: string, now: string): Promise<void>;
  deadLetter(jobId: string, workerId: string, error: string, now: string): Promise<void>;
  requestCancellation(jobId: string, now: string): Promise<OutboxJob | null>;
  markCancelled(jobId: string, workerId: string, now: string): Promise<void>;
}

export type SqlExecutor = Readonly<{
  query<T extends Record<string, unknown>>(sql: string, parameters: readonly unknown[]): Promise<readonly T[]>;
}>;

export const OUTBOX_SQL = Object.freeze({
  enqueue: `
    INSERT INTO jobs (
      id, organization_id, workspace_id, job_type, idempotency_key, payload,
      status, attempts, max_attempts, run_after, created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, 'queued', 0, $7, $8, $9, $9)
    ON CONFLICT (workspace_id, idempotency_key) DO NOTHING
    RETURNING *
  `,
  findByIdempotency: `
    SELECT * FROM jobs WHERE workspace_id = $1 AND idempotency_key = $2 LIMIT 1
  `,
  get: `SELECT * FROM jobs WHERE id = $1 LIMIT 1`,
  claimNext: `
    WITH candidate AS (
      SELECT id
      FROM jobs
      WHERE status IN ('queued', 'retry')
        AND run_after <= $1
        AND cancelled_at IS NULL
        AND ($3::text[] IS NULL OR job_type = ANY($3::text[]))
      ORDER BY run_after ASC, id ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    UPDATE jobs AS job
    SET status = 'processing',
        attempts = job.attempts + 1,
        locked_at = $1,
        locked_by = $2,
        updated_at = $1
    FROM candidate
    WHERE job.id = candidate.id
    RETURNING job.*
  `,
  complete: `
    UPDATE jobs
    SET status = 'completed', completed_at = $3, locked_at = NULL, locked_by = NULL,
        last_error = NULL, updated_at = $3
    WHERE id = $1 AND status = 'processing' AND locked_by = $2
    RETURNING id
  `,
  retry: `
    UPDATE jobs
    SET status = 'retry', run_after = $3, last_error = $4,
        locked_at = NULL, locked_by = NULL, updated_at = $5
    WHERE id = $1 AND status = 'processing' AND locked_by = $2
    RETURNING id
  `,
  deadLetter: `
    UPDATE jobs
    SET status = 'dead_letter', last_error = $3, locked_at = NULL, locked_by = NULL,
        completed_at = $4, updated_at = $4
    WHERE id = $1 AND status = 'processing' AND locked_by = $2
    RETURNING id
  `,
  requestCancellation: `
    UPDATE jobs
    SET cancelled_at = COALESCE(cancelled_at, $2),
        status = CASE WHEN status IN ('queued', 'retry') THEN 'cancelled' ELSE status END,
        completed_at = CASE WHEN status IN ('queued', 'retry') THEN $2 ELSE completed_at END,
        updated_at = $2
    WHERE id = $1 AND status NOT IN ('completed', 'dead_letter', 'cancelled')
    RETURNING *
  `,
  markCancelled: `
    UPDATE jobs
    SET status = 'cancelled', completed_at = $3, locked_at = NULL, locked_by = NULL,
        updated_at = $3
    WHERE id = $1 AND status = 'processing' AND locked_by = $2
    RETURNING id
  `,
});

type OutboxRow = Record<string, unknown>;

function toIso(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function mapRow(row: OutboxRow): OutboxJob {
  return Object.freeze({
    id: String(row.id),
    organizationId: String(row.organization_id),
    workspaceId: String(row.workspace_id),
    jobType: String(row.job_type),
    idempotencyKey: String(row.idempotency_key),
    payload: typeof row.payload === "string" ? JSON.parse(row.payload) : structuredClone(row.payload ?? {}),
    status: String(row.status) as OutboxJobStatus,
    attempts: Number(row.attempts),
    maxAttempts: Number(row.max_attempts),
    availableAt: toIso(row.run_after) ?? "",
    lockedAt: toIso(row.locked_at),
    lockedBy: row.locked_by === null || row.locked_by === undefined ? null : String(row.locked_by),
    cancelRequestedAt: toIso(row.cancelled_at),
    completedAt: toIso(row.completed_at),
    lastError: row.last_error === null || row.last_error === undefined ? null : String(row.last_error),
    createdAt: toIso(row.created_at) ?? "",
    updatedAt: toIso(row.updated_at) ?? "",
  });
}

export class PostgresOutboxRepository implements OutboxRepository {
  readonly #sql: SqlExecutor;

  constructor(sql: SqlExecutor) {
    this.#sql = sql;
  }

  async enqueue(input: EnqueueOutboxJob): Promise<Readonly<{ job: OutboxJob; duplicate: boolean }>> {
    const rows = await this.#sql.query<OutboxRow>(OUTBOX_SQL.enqueue, [
      input.id,
      input.organizationId,
      input.workspaceId,
      input.jobType,
      input.idempotencyKey,
      JSON.stringify(input.payload),
      input.maxAttempts,
      input.availableAt,
      input.createdAt,
    ]);
    if (rows[0]) return { job: mapRow(rows[0]), duplicate: false };
    const existing = await this.#sql.query<OutboxRow>(OUTBOX_SQL.findByIdempotency, [input.workspaceId, input.idempotencyKey]);
    if (!existing[0]) throw new OutboxWorkerError("OUTBOX_CONCURRENT_WRITE", "The idempotent job was not visible after enqueue.", true);
    return { job: mapRow(existing[0]), duplicate: true };
  }

  async get(jobId: string): Promise<OutboxJob | null> {
    const rows = await this.#sql.query<OutboxRow>(OUTBOX_SQL.get, [jobId]);
    return rows[0] ? mapRow(rows[0]) : null;
  }

  async claimNext(workerId: string, now: string, supportedJobTypes?: readonly string[]): Promise<OutboxJob | null> {
    const rows = await this.#sql.query<OutboxRow>(OUTBOX_SQL.claimNext, [now, workerId, supportedJobTypes ? [...supportedJobTypes] : null]);
    return rows[0] ? mapRow(rows[0]) : null;
  }

  async complete(jobId: string, workerId: string, now: string): Promise<void> {
    await this.#assertTransition(OUTBOX_SQL.complete, [jobId, workerId, now]);
  }

  async retry(jobId: string, workerId: string, availableAt: string, error: string, now: string): Promise<void> {
    await this.#assertTransition(OUTBOX_SQL.retry, [jobId, workerId, availableAt, error, now]);
  }

  async deadLetter(jobId: string, workerId: string, error: string, now: string): Promise<void> {
    await this.#assertTransition(OUTBOX_SQL.deadLetter, [jobId, workerId, error, now]);
  }

  async requestCancellation(jobId: string, now: string): Promise<OutboxJob | null> {
    const rows = await this.#sql.query<OutboxRow>(OUTBOX_SQL.requestCancellation, [jobId, now]);
    return rows[0] ? mapRow(rows[0]) : this.get(jobId);
  }

  async markCancelled(jobId: string, workerId: string, now: string): Promise<void> {
    await this.#assertTransition(OUTBOX_SQL.markCancelled, [jobId, workerId, now]);
  }

  async #assertTransition(sql: string, parameters: readonly unknown[]): Promise<void> {
    const rows = await this.#sql.query<Record<string, unknown>>(sql, parameters);
    if (!rows[0]) {
      throw new OutboxWorkerError("OUTBOX_LOCK_LOST", "The worker no longer owns the claimed outbox job.", true);
    }
  }
}

export type OutboxWorkerErrorCode =
  | "OUTBOX_HANDLER_MISSING"
  | "OUTBOX_LOCK_LOST"
  | "OUTBOX_CONCURRENT_WRITE"
  | "JOB_CANCELLED";

export class OutboxWorkerError extends Error {
  readonly code: OutboxWorkerErrorCode;
  readonly retryable: boolean;

  constructor(code: OutboxWorkerErrorCode, message: string, retryable: boolean) {
    super(message);
    this.name = "OutboxWorkerError";
    this.code = code;
    this.retryable = retryable;
  }
}

export type OutboxHandlerContext = Readonly<{
  workerId: string;
  isCancellationRequested(): Promise<boolean>;
  throwIfCancellationRequested(): Promise<void>;
}>;

export type OutboxHandler = (
  job: OutboxJob,
  context: OutboxHandlerContext,
) => Promise<void>;

export type WorkerClock = Readonly<{
  now(): Date;
}>;

export type OutboxWorkerOptions = Readonly<{
  workerId: string;
  repository: OutboxRepository;
  handlers: Readonly<Record<string, OutboxHandler>>;
  clock?: WorkerClock;
  baseRetryDelayMs?: number;
  maxRetryDelayMs?: number;
}>;

export class OutboxWorker {
  readonly #workerId: string;
  readonly #repository: OutboxRepository;
  readonly #handlers: Readonly<Record<string, OutboxHandler>>;
  readonly #clock: WorkerClock;
  readonly #baseRetryDelayMs: number;
  readonly #maxRetryDelayMs: number;

  constructor(options: OutboxWorkerOptions) {
    this.#workerId = options.workerId;
    this.#repository = options.repository;
    this.#handlers = options.handlers;
    this.#clock = options.clock ?? { now: () => new Date() };
    this.#baseRetryDelayMs = options.baseRetryDelayMs ?? 1_000;
    this.#maxRetryDelayMs = options.maxRetryDelayMs ?? 60_000;
  }

  async processNext(): Promise<Readonly<{ processed: boolean; jobId: string | null; status: OutboxJobStatus | null }>> {
    const now = this.#clock.now().toISOString();
    const job = await this.#repository.claimNext(this.#workerId, now, Object.keys(this.#handlers));
    if (!job) return { processed: false, jobId: null, status: null };
    const handler = this.#handlers[job.jobType];
    if (!handler) {
      await this.#repository.deadLetter(job.id, this.#workerId, `No handler is registered for ${job.jobType}.`, now);
      return { processed: true, jobId: job.id, status: "dead_letter" };
    }

    const isCancellationRequested = async (): Promise<boolean> => {
      const current = await this.#repository.get(job.id);
      return current?.cancelRequestedAt !== null || current?.status === "cancelled";
    };
    const context: OutboxHandlerContext = {
      workerId: this.#workerId,
      isCancellationRequested,
      throwIfCancellationRequested: async () => {
        if (await isCancellationRequested()) {
          throw new OutboxWorkerError("JOB_CANCELLED", "Cancellation was requested for this job.", false);
        }
      },
    };

    try {
      await context.throwIfCancellationRequested();
      await handler(job, context);
      await context.throwIfCancellationRequested();
      const completedAt = this.#clock.now().toISOString();
      await this.#repository.complete(job.id, this.#workerId, completedAt);
      return { processed: true, jobId: job.id, status: "completed" };
    } catch (error) {
      const failedAt = this.#clock.now().toISOString();
      if (error instanceof OutboxWorkerError && error.code === "JOB_CANCELLED") {
        await this.#repository.markCancelled(job.id, this.#workerId, failedAt);
        return { processed: true, jobId: job.id, status: "cancelled" };
      }
      const message = error instanceof Error ? error.message : "Unknown outbox handler error";
      const retryable = !(error instanceof OutboxWorkerError) || error.retryable;
      if (retryable && job.attempts < job.maxAttempts) {
        const delay = Math.min(this.#maxRetryDelayMs, this.#baseRetryDelayMs * 2 ** Math.max(0, job.attempts - 1));
        const availableAt = new Date(this.#clock.now().getTime() + delay).toISOString();
        await this.#repository.retry(job.id, this.#workerId, availableAt, message, failedAt);
        return { processed: true, jobId: job.id, status: "retry" };
      }
      await this.#repository.deadLetter(job.id, this.#workerId, message, failedAt);
      return { processed: true, jobId: job.id, status: "dead_letter" };
    }
  }

  async drain(maxJobs: number): Promise<readonly Readonly<{ jobId: string; status: OutboxJobStatus }>[] > {
    if (!Number.isInteger(maxJobs) || maxJobs < 1) {
      throw new RangeError("maxJobs must be a positive integer.");
    }
    const processed: Array<Readonly<{ jobId: string; status: OutboxJobStatus }>> = [];
    while (processed.length < maxJobs) {
      const result = await this.processNext();
      if (!result.processed || !result.jobId || !result.status) break;
      processed.push({ jobId: result.jobId, status: result.status });
    }
    return processed;
  }
}

/** Deterministic local/test repository; production must use Postgres. */
export class InMemoryOutboxRepository implements OutboxRepository {
  readonly #jobs = new Map<string, OutboxJob>();
  readonly #idempotency = new Map<string, string>();

  async enqueue(input: EnqueueOutboxJob): Promise<Readonly<{ job: OutboxJob; duplicate: boolean }>> {
    const idempotency = `${input.workspaceId}:${input.idempotencyKey}`;
    const existingId = this.#idempotency.get(idempotency);
    if (existingId) return { job: structuredClone(this.#jobs.get(existingId) as OutboxJob), duplicate: true };
    const job: OutboxJob = Object.freeze({
      ...structuredClone(input),
      status: "queued",
      attempts: 0,
      lockedAt: null,
      lockedBy: null,
      cancelRequestedAt: null,
      completedAt: null,
      lastError: null,
      updatedAt: input.createdAt,
    });
    this.#jobs.set(job.id, job);
    this.#idempotency.set(idempotency, job.id);
    return { job: structuredClone(job), duplicate: false };
  }

  async get(jobId: string): Promise<OutboxJob | null> {
    const job = this.#jobs.get(jobId);
    return job ? structuredClone(job) : null;
  }

  async claimNext(workerId: string, now: string, supportedJobTypes?: readonly string[]): Promise<OutboxJob | null> {
    const supported = supportedJobTypes ? new Set(supportedJobTypes) : null;
    const due = [...this.#jobs.values()]
      .filter((job) =>
        (job.status === "queued" || job.status === "retry") &&
        job.availableAt <= now &&
        !job.cancelRequestedAt &&
        (!supported || supported.has(job.jobType)))
      .sort((left, right) => left.availableAt.localeCompare(right.availableAt) || left.id.localeCompare(right.id))[0];
    if (!due) return null;
    const claimed: OutboxJob = Object.freeze({
      ...due,
      status: "processing",
      attempts: due.attempts + 1,
      lockedAt: now,
      lockedBy: workerId,
      updatedAt: now,
    });
    this.#jobs.set(claimed.id, claimed);
    return structuredClone(claimed);
  }

  async complete(jobId: string, workerId: string, now: string): Promise<void> {
    this.#transition(jobId, workerId, { status: "completed", completedAt: now, lockedAt: null, lockedBy: null, lastError: null, updatedAt: now });
  }

  async retry(jobId: string, workerId: string, availableAt: string, error: string, now: string): Promise<void> {
    this.#transition(jobId, workerId, { status: "retry", availableAt, lastError: error, lockedAt: null, lockedBy: null, updatedAt: now });
  }

  async deadLetter(jobId: string, workerId: string, error: string, now: string): Promise<void> {
    this.#transition(jobId, workerId, { status: "dead_letter", lastError: error, completedAt: now, lockedAt: null, lockedBy: null, updatedAt: now });
  }

  async requestCancellation(jobId: string, now: string): Promise<OutboxJob | null> {
    const job = this.#jobs.get(jobId);
    if (!job || job.status === "completed" || job.status === "dead_letter" || job.status === "cancelled") {
      return job ? structuredClone(job) : null;
    }
    const queued = job.status === "queued" || job.status === "retry";
    const next: OutboxJob = Object.freeze({
      ...job,
      cancelRequestedAt: job.cancelRequestedAt ?? now,
      status: queued ? "cancelled" : job.status,
      completedAt: queued ? now : job.completedAt,
      updatedAt: now,
    });
    this.#jobs.set(jobId, next);
    return structuredClone(next);
  }

  async markCancelled(jobId: string, workerId: string, now: string): Promise<void> {
    this.#transition(jobId, workerId, { status: "cancelled", completedAt: now, lockedAt: null, lockedBy: null, updatedAt: now });
  }

  #transition(jobId: string, workerId: string, patch: Partial<OutboxJob>): void {
    const job = this.#jobs.get(jobId);
    if (!job || job.status !== "processing" || job.lockedBy !== workerId) {
      throw new OutboxWorkerError("OUTBOX_LOCK_LOST", "The worker no longer owns the claimed outbox job.", true);
    }
    this.#jobs.set(jobId, Object.freeze({ ...job, ...patch }));
  }
}
