import { type ChildProcess, spawn, type SpawnOptions } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import nextEnv from "@next/env";
import { assertMigrationIdentity, createMigrationPlan } from "../lib/migration/safe-migration.ts";

const { loadEnvConfig } = nextEnv;
const prismaCliPath = fileURLToPath(new URL("../node_modules/prisma/build/index.js", import.meta.url));

type ProcessLauncher = (
  command: string,
  arguments_: readonly string[],
  options: SpawnOptions,
) => ChildProcess;

async function readIdentity(connectionString: string) {
  const client = new Client({ connectionString });
  try {
    await client.connect();
    const result = await client.query<{
      branch_id: string | null;
      database_name: string;
    }>(`
      SELECT
        current_setting('neon.branch_id', true) AS branch_id,
        current_database() AS database_name
    `);
    return {
      branchId: result.rows[0]?.branch_id ?? null,
      databaseName: result.rows[0]?.database_name ?? "",
    };
  } finally {
    await client.end().catch(() => undefined);
  }
}

export function prismaDeployInvocation(environment: NodeJS.ProcessEnv) {
  return {
    command: process.execPath,
    arguments_: [
      prismaCliPath,
      "migrate",
      "deploy",
      "--config",
      resolve(process.cwd(), "prisma.migration.config.ts"),
    ],
    options: {
      cwd: process.cwd(),
      env: environment,
      stdio: "inherit" as const,
      shell: false,
    },
  };
}

export function runPrisma(environment: NodeJS.ProcessEnv, launch: ProcessLauncher = spawn) {
  const invocation = prismaDeployInvocation(environment);
  return new Promise<number>((resolve, reject) => {
    const child = launch(invocation.command, invocation.arguments_, invocation.options);
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
}

async function main() {
  // This loads dedicated PRISMA_MIGRATION_* values for the launcher only.
  // prisma.migration.config.ts never loads .env.local and never reads app URLs.
  loadEnvConfig(process.cwd());
  const plan = createMigrationPlan(process.env);
  const identity = await readIdentity(plan.connectionString);
  assertMigrationIdentity(plan, identity);

  console.log(JSON.stringify({ target: plan.target, branchId: identity.branchId, preflight: "passed" }));

  const code = await runPrisma({
    ...process.env,
    PRISMA_MIGRATION_URL: plan.connectionString,
    PRISMA_MIGRATION_GUARD: `validated:${plan.target}`,
  });
  if (code !== 0) process.exitCode = code;
}

const invokedAsScript = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedAsScript) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Unknown safe migration failure.";
    // Errors are intentionally sanitized: never include a connection value.
    console.error(`Safe migration blocked: ${message}`);
    process.exitCode = 1;
  });
}
