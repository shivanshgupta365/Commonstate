import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type CommonstateDb = ReturnType<typeof drizzle<typeof schema>>;

let client: ReturnType<typeof postgres> | null = null;
let database: CommonstateDb | null = null;

function connectionUrl(): string | null {
  const value = process.env.DATABASE_URL?.trim();
  return value ? value : null;
}

/**
 * Return the process-local Drizzle client. Supabase's transaction pooler does
 * not support prepared statements, so they are disabled explicitly.
 */
export function getDb(): CommonstateDb {
  if (database) return database;

  const url = connectionUrl();
  if (!url) {
    throw new Error("DATABASE_URL is required for PostgreSQL persistence.");
  }

  client = postgres(url, {
    prepare: false,
    max: Number(process.env.POSTGRES_POOL_MAX ?? "3"),
    connect_timeout: 5,
    idle_timeout: 20,
  });
  database = drizzle(client, { schema });
  return database;
}

/** Return null only when persistence is intentionally unconfigured locally. */
export async function tryGetDb(): Promise<CommonstateDb | null> {
  return connectionUrl() ? getDb() : null;
}

/** Test/process-shutdown hook; application requests reuse the singleton. */
export async function closeDb(): Promise<void> {
  if (client) await client.end({ timeout: 5 });
  client = null;
  database = null;
}
