export type WorkerCycleResult = Readonly<{
  processed: boolean;
  jobId: string | null;
  status: string | null;
}>;

export type WorkerProcessor = Readonly<{
  processNext(): Promise<WorkerCycleResult>;
}>;

export type WorkerRuntimeSnapshot = Readonly<{
  workerId: string;
  state: "starting" | "running" | "stopping" | "stopped" | "failed";
  startedAt: string;
  lastCycleAt: string | null;
  lastJobId: string | null;
  processedJobs: number;
  failedCycles: number;
  lastError: string | null;
}>;

export type WorkerRuntimeOptions = Readonly<{
  workerId: string;
  processor: WorkerProcessor;
  signal: AbortSignal;
  idlePollMs?: number;
  failureBackoffMs?: number;
  now?: () => Date;
  onSnapshot?: (snapshot: WorkerRuntimeSnapshot) => void | Promise<void>;
}>;

function wait(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const finish = (): void => {
      signal.removeEventListener("abort", abort);
      resolve();
    };
    const timer = setTimeout(finish, milliseconds);
    const abort = (): void => {
      clearTimeout(timer);
      finish();
    };
    signal.addEventListener("abort", abort, { once: true });
  });
}

/**
 * Runs a cooperative worker loop. Fly.io shutdown can abort the signal, which
 * stops new claims and lets the current handler settle before this promise ends.
 */
export async function runWorkerRuntime(options: WorkerRuntimeOptions): Promise<WorkerRuntimeSnapshot> {
  const now = options.now ?? (() => new Date());
  const idlePollMs = options.idlePollMs ?? 1_000;
  const failureBackoffMs = options.failureBackoffMs ?? 5_000;
  if (!options.workerId.trim()) throw new RangeError("workerId is required.");
  if (idlePollMs < 25 || failureBackoffMs < 25) throw new RangeError("Worker delays must be at least 25ms.");

  let snapshot: WorkerRuntimeSnapshot = {
    workerId: options.workerId,
    state: "starting",
    startedAt: now().toISOString(),
    lastCycleAt: null,
    lastJobId: null,
    processedJobs: 0,
    failedCycles: 0,
    lastError: null,
  };
  const publish = async (patch: Partial<WorkerRuntimeSnapshot>): Promise<void> => {
    snapshot = Object.freeze({ ...snapshot, ...patch });
    await options.onSnapshot?.(snapshot);
  };
  await publish({ state: "running" });

  while (!options.signal.aborted) {
    try {
      const result = await options.processor.processNext();
      await publish({
        lastCycleAt: now().toISOString(),
        lastJobId: result.jobId,
        processedJobs: snapshot.processedJobs + (result.processed ? 1 : 0),
        lastError: null,
      });
      if (!result.processed) await wait(idlePollMs, options.signal);
    } catch (error) {
      await publish({
        lastCycleAt: now().toISOString(),
        failedCycles: snapshot.failedCycles + 1,
        lastError: error instanceof Error ? error.message : "Unknown worker cycle failure",
      });
      await wait(failureBackoffMs, options.signal);
    }
  }

  await publish({ state: "stopping" });
  await publish({ state: "stopped" });
  return snapshot;
}
