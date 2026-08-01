import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type CommonstateDb = ReturnType<typeof drizzle<typeof schema>>;

let client: ReturnType<typeof postgres> | null = null;
let database: CommonstateDb | null = null;
let productClient: ReturnType<typeof postgres> | null = null;
let productDatabase: CommonstateDb | null = null;

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

function productConnectionUrl(): string {
  const explicit = process.env.PRODUCT_DATABASE_URL?.trim();
  if (explicit) return explicit;
  const fallback = connectionUrl();
  if (
    fallback &&
    !process.env.VERCEL &&
    !process.env.CI &&
    /(?:localhost|127\.0\.0\.1|\[::1\])(?::|\/)/.test(fallback)
  ) {
    return fallback;
  }
  throw new Error(
    "PRODUCT_DATABASE_URL is required for authenticated product requests. Configure it with the restricted commonstate runtime role; DATABASE_URL remains the server-only auth/provisioning connection.",
  );
}

/**
 * Authenticated product requests use a distinct restricted PostgreSQL role so
 * transaction-local tenant settings are enforced independently by RLS.
 * Local PostgreSQL may reuse DATABASE_URL for developer ergonomics only.
 */
export function getProductDb(): CommonstateDb {
  if (productDatabase) return productDatabase;
  productClient = postgres(productConnectionUrl(), {
    prepare: false,
    max: Number(process.env.PRODUCT_POSTGRES_POOL_MAX ?? process.env.POSTGRES_POOL_MAX ?? "3"),
    connect_timeout: 5,
    idle_timeout: 20,
  });
  productDatabase = drizzle(productClient, { schema });
  return productDatabase;
}

/** Return null only when persistence is intentionally unconfigured locally. */
export async function tryGetDb(): Promise<CommonstateDb | null> {
  return connectionUrl() ? getDb() : null;
}

/** Test/process-shutdown hook; application requests reuse the singleton. */
export async function closeDb(): Promise<void> {
  if (client) await client.end({ timeout: 5 });
  if (productClient) await productClient.end({ timeout: 5 });
  client = null;
  database = null;
  productClient = null;
  productDatabase = null;
}
