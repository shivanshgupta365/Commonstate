import { sql } from "drizzle-orm";
import { getDb } from "../db";

const HEALTH_DEADLINE_MS = 1_250;

type RetrievalProbe = Readonly<{
  source_chunks_ready: boolean;
  vector_enabled: boolean;
  vector_column: boolean;
}>;

export type HealthReport = Readonly<{
  status: "ready" | "unavailable";
  timestamp: string;
  checks: Readonly<{
    web: Readonly<{ ready: true }>;
    database: Readonly<{ ready: boolean }>;
    retrieval: Readonly<{
      ready: boolean;
      mode: "hybrid" | "keyword" | "unavailable";
    }>;
  }>;
}>;

async function probeDatabase(): Promise<RetrievalProbe> {
  const result = await getDb().execute(sql`
    select
      to_regclass('public.source_chunks') is not null as source_chunks_ready,
      exists(select 1 from pg_extension where extname = 'vector') as vector_enabled,
      exists(
        select 1 from information_schema.columns
        where table_schema = 'public'
          and table_name = 'source_chunks'
          and column_name = 'embedding_vector'
      ) as vector_column
  `);
  const row = (result as unknown as RetrievalProbe[])[0];
  if (!row) throw new Error("database health probe returned no row");
  return row;
}

export async function healthReport(
  probe: () => Promise<RetrievalProbe> = probeDatabase,
): Promise<HealthReport> {
  try {
    const result = await Promise.race([
      probe(),
      new Promise<never>((_, reject) => {
        const timer = setTimeout(() => reject(new Error("health deadline exceeded")), HEALTH_DEADLINE_MS);
        timer.unref?.();
      }),
    ]);
    const retrievalReady = result.source_chunks_ready === true;
    const mode = !retrievalReady
      ? "unavailable"
      : result.vector_enabled === true && result.vector_column === true
        ? "hybrid"
        : "keyword";
    return Object.freeze({
      status: retrievalReady ? "ready" : "unavailable",
      timestamp: new Date().toISOString(),
      checks: Object.freeze({
        web: Object.freeze({ ready: true as const }),
        database: Object.freeze({ ready: true }),
        retrieval: Object.freeze({ ready: retrievalReady, mode }),
      }),
    });
  } catch {
    return Object.freeze({
      status: "unavailable",
      timestamp: new Date().toISOString(),
      checks: Object.freeze({
        web: Object.freeze({ ready: true as const }),
        database: Object.freeze({ ready: false }),
        retrieval: Object.freeze({ ready: false, mode: "unavailable" as const }),
      }),
    });
  }
}

export async function healthResponse(): Promise<Response> {
  const report = await healthReport();
  return Response.json(report, {
    status: report.status === "ready" ? 200 : 503,
    headers: {
      "cache-control": "no-store, max-age=0",
      "content-type": "application/json; charset=utf-8",
    },
  });
}
