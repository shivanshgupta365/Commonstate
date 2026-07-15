import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

type D1Binding = Parameters<typeof drizzle>[0];

async function getD1Binding(): Promise<D1Binding | null> {
  try {
    // Lazy loading keeps plain Node from resolving the Cloudflare-only protocol
    // at module load while retaining a statically discoverable Worker import.
    // @ts-expect-error `cloudflare:workers` exists in the Worker runtime.
    const workers = (await import("cloudflare:workers")) as {
      env?: Record<string, unknown>;
    };
    return (workers.env?.DB as D1Binding | undefined) ?? null;
  } catch {
    return null;
  }
}

export type CommonstateDb = ReturnType<typeof drizzle<typeof schema>>;

/** Legacy synchronous accessor retained for the opt-in example route. */
export function getDb(): CommonstateDb {
  const workerGlobal = globalThis as typeof globalThis & { DB?: D1Binding };
  const binding = workerGlobal.DB ?? null;
  if (!binding) {
    throw new Error(
      "Cloudflare D1 binding `DB` is unavailable. Set the `d1` field in .openai/hosting.json to `DB` or let the control plane inject the real binding values before using the database.",
    );
  }
  return drizzle(binding, { schema });
}

/**
 * API routes use this when the interactive demo should remain usable without a
 * local D1 binding (for example during a plain Node build). Production writes
 * still prefer D1 whenever the binding is present.
 */
export async function tryGetDb(): Promise<CommonstateDb | null> {
  try {
    const binding = await getD1Binding();
    return binding ? drizzle(binding, { schema }) : null;
  } catch {
    return null;
  }
}
