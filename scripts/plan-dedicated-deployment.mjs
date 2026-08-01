import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import process from "node:process";
import Ajv2020 from "ajv/dist/2020.js";

const manifestPath = process.argv[2] ?? "deploy/dedicated/manifest.example.json";
if (manifestPath === "--help" || manifestPath === "-h") {
  process.stdout.write("Usage: npm run deploy:dedicated:plan -- [manifest.json]\n");
  process.exit(0);
}

let manifestText;
let schemaText;
try {
  [manifestText, schemaText] = await Promise.all([
    readFile(manifestPath, "utf8"),
    readFile(new URL("../deploy/dedicated/manifest.schema.json", import.meta.url), "utf8"),
  ]);
} catch (error) {
  process.stderr.write(`Unable to read the dedicated deployment manifest: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}

let manifest;
let schema;
try {
  manifest = JSON.parse(manifestText);
  schema = JSON.parse(schemaText);
} catch (error) {
  process.stderr.write(`Dedicated deployment JSON is invalid: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]),
  );
}

function digest(value) {
  return createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");
}

function semanticErrors(input) {
  const errors = [];
  const allowedSecretReference = /^(?:vault|aws-sm|gcp-sm|azure-kv|doppler|vercel-env):\/\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]+$/;
  for (const [name, reference] of Object.entries(input.secrets ?? {})) {
    if (!allowedSecretReference.test(reference)) {
      errors.push(`/secrets/${name} must be a supported secret-manager reference, never a credential or network URL`);
    }
  }
  const references = Object.values(input.secrets ?? {});
  if (new Set(references).size !== references.length) {
    errors.push("/secrets each deployment secret must use a distinct reference");
  }
  try {
    const health = new URL(input.monitoring.healthUrl);
    if (health.protocol !== "https:") errors.push("/monitoring/healthUrl must use HTTPS");
    if (health.hostname !== input.domain.hostname) {
      errors.push("/monitoring/healthUrl must use the dedicated deployment hostname");
    }
    if (health.pathname !== "/api/health") {
      errors.push("/monitoring/healthUrl must target /api/health");
    }
  } catch {
    errors.push("/monitoring/healthUrl must be a valid URL");
  }
  if (!Array.isArray(input.fly.command) || !input.fly.command.join(" ").includes("worker:start")) {
    errors.push("/fly/command must start the Commonstate worker runtime");
  }
  if (input.vercel.projectName === input.fly.appName) {
    errors.push("/fly/appName and /vercel/projectName must be distinct infrastructure targets");
  }
  return errors;
}
const ajv = new Ajv2020({ allErrors: true, strict: true });
ajv.addFormat("hostname", /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i);
ajv.addFormat("uri", /^[a-z][a-z0-9+.-]*:\/\//i);
const validate = ajv.compile(schema);
const manifestValid = validate(manifest);
const manifestSemanticErrors = manifestValid ? semanticErrors(manifest) : [];

if (!manifestValid) {
  for (const error of validate.errors ?? []) {
    process.stderr.write(`${error.instancePath || "/"} ${error.message}\n`);
  }
  process.exitCode = 1;
} else if (manifestSemanticErrors.length) {
  for (const error of manifestSemanticErrors) process.stderr.write(`${error}\n`);
  process.exitCode = 1;
} else if (
  manifest.customer.environment === "production" &&
  !/^[a-f0-9]{40}$/i.test(manifest.vercel.gitRef)
) {
  process.stderr.write("/vercel/gitRef production deployments require a full 40-character reviewed commit SHA\n");
  process.exitCode = 1;
} else {
  const plan = {
    schemaVersion: 1,
    manifestHash: digest(manifest),
    deploymentId: `${manifest.customer.slug}:${manifest.customer.environment}:${manifest.vercel.gitRef}`,
    immutableInputs: {
      customer: manifest.customer.slug,
      gitRef: manifest.vercel.gitRef,
      region: manifest.region,
      hostname: manifest.domain.hostname,
    },
    phases: [
      {
        id: "supabase",
        target: manifest.supabase.projectRef,
        checks: [
          "PITR enabled",
          `private bucket ${manifest.supabase.storageBucket}`,
          "migrations applied twice",
          "commonstate_runtime installed with NOBYPASSRLS",
          "RLS negative suite passed as runtime role",
        ],
      },
      {
        id: "identity",
        target: manifest.customer.displayName,
        checks: [
          "Supabase Auth redirect allowlist",
          "WorkOS organization and verified domain",
          "Directory Sync webhook signature",
          "deprovisioning smoke test",
        ],
      },
      {
        id: "web",
        target: manifest.vercel.projectName,
        checks: [
          `deploy reviewed commit ${manifest.vercel.gitRef}`,
          `bind ${manifest.domain.hostname}`,
          "owner, runtime, and migration credentials remain separate",
          "HTTPS incognito product workflow",
        ],
      },
      {
        id: "worker",
        target: manifest.fly.appName,
        checks: [
          `${manifest.fly.minMachines} minimum machine(s) in ${manifest.fly.region}`,
          "concrete worker handler module configured",
          "outbox, retry, cancellation, and dead-letter smoke tests",
          "kill-switch preflight",
        ],
      },
      {
        id: "release",
        target: manifest.monitoring.healthUrl,
        checks: [
          "web and worker health green",
          "backup and restore rehearsal passed",
          "tenant isolation and connector deletion tests passed",
          "customer retention and action policy approved",
        ],
      },
    ],
    secretReferences: Object.fromEntries(
      Object.entries(manifest.secrets).sort(([left], [right]) => left.localeCompare(right)),
    ),
  };

  process.stdout.write(`${JSON.stringify({ ...plan, planHash: digest(plan) }, null, 2)}\n`);
}
