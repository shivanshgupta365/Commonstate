import { createServer, type Server } from "node:http";
import { hostname } from "node:os";
import postgres from "postgres";

import {
  OutboxWorker,
  PostgresOutboxRepository,
  type OutboxHandler,
  type SqlExecutor,
} from "./outbox.ts";
import { runWorkerRuntime, type WorkerRuntimeSnapshot } from "./runtime.ts";

type HandlerFactoryModule = Readonly<{
  createHandlers(input: {
    sql: ReturnType<typeof postgres>;
    environment: NodeJS.ProcessEnv;
  }): Promise<Readonly<Record<string, OutboxHandler>>> | Readonly<Record<string, OutboxHandler>>;
}>;

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required to run the Commonstate worker.`);
  return value;
}

async function loadHandlers(sql: ReturnType<typeof postgres>): Promise<Readonly<Record<string, OutboxHandler>>> {
  const moduleSpecifier = process.env.WORKER_HANDLER_MODULE?.trim();
  if (!moduleSpecifier) {
    return {
      "platform.health": async () => {
        await sql`SELECT 1`;
      },
    };
  }
  const loaded = await import(moduleSpecifier) as Partial<HandlerFactoryModule>;
  if (typeof loaded.createHandlers !== "function") {
    throw new Error("WORKER_HANDLER_MODULE must export createHandlers({ sql, environment }).");
  }
  const handlers = await loaded.createHandlers({ sql, environment: process.env });
  for (const [jobType, handler] of Object.entries(handlers)) {
    if (!jobType.trim() || typeof handler !== "function") {
      throw new Error("Worker handler modules must return a record of non-empty job types to functions.");
    }
  }
  return handlers;
}

function startHealthServer(input: {
  port: number;
  snapshot: () => WorkerRuntimeSnapshot | null;
  handlerCount: number;
}): Server {
  return createServer((request, response) => {
    if (request.url !== "/health" && request.url !== "/ready") {
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: false, code: "NOT_FOUND" }));
      return;
    }
    const snapshot = input.snapshot();
    const ready = Boolean(snapshot && snapshot.state === "running" && input.handlerCount > 0);
    response.writeHead(request.url === "/ready" && !ready ? 503 : 200, {
      "content-type": "application/json",
      "cache-control": "no-store",
    });
    response.end(JSON.stringify({ ok: request.url === "/health" || ready, ready, handlerCount: input.handlerCount, worker: snapshot }));
  }).listen(input.port, "0.0.0.0");
}

async function main(): Promise<void> {
  const databaseUrl = required("DATABASE_URL");
  const sql = postgres(databaseUrl, {
    prepare: false,
    max: Number(process.env.WORKER_POSTGRES_POOL_MAX ?? "3"),
    connect_timeout: 5,
    idle_timeout: 20,
  });
  await sql`SELECT 1`;

  const executor: SqlExecutor = {
    query: async <T extends Record<string, unknown>>(statement: string, parameters: readonly unknown[]) => {
      const rows = await sql.unsafe<T[]>(statement, [...parameters] as never[]);
      return rows;
    },
  };
  const handlers = await loadHandlers(sql);
  const workerId = process.env.WORKER_ID?.trim() || `${hostname()}:${process.pid}`;
  const repository = new PostgresOutboxRepository(executor);
  const worker = new OutboxWorker({
    workerId,
    repository,
    handlers,
    baseRetryDelayMs: Number(process.env.WORKER_BASE_RETRY_MS ?? "1000"),
    maxRetryDelayMs: Number(process.env.WORKER_MAX_RETRY_MS ?? "60000"),
  });
  const shutdown = new AbortController();
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => shutdown.abort());
  }

  let latestSnapshot: WorkerRuntimeSnapshot | null = null;
  const server = startHealthServer({
    port: Number(process.env.WORKER_HEALTH_PORT ?? "8080"),
    snapshot: () => latestSnapshot,
    handlerCount: Object.keys(handlers).length,
  });
  try {
    await runWorkerRuntime({
      workerId,
      processor: worker,
      signal: shutdown.signal,
      idlePollMs: Number(process.env.WORKER_IDLE_POLL_MS ?? "1000"),
      failureBackoffMs: Number(process.env.WORKER_FAILURE_BACKOFF_MS ?? "5000"),
      onSnapshot: (snapshot) => { latestSnapshot = snapshot; },
    });
  } finally {
    server.close();
    await sql.end({ timeout: 5 });
  }
}

main().catch((error) => {
  process.stderr.write(`Commonstate worker failed: ${error instanceof Error ? error.message : "unknown error"}\n`);
  process.exitCode = 1;
});
