import { createHash } from "node:crypto";
import nextEnv from "@next/env";
import { neon } from "@neondatabase/serverless";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

type TargetName = "production" | "backup" | "test";
type Target = { name: TargetName; connectionString: string };

const targets: Target[] = [
  { name: "production", connectionString: process.env.DATABASE_URL_UNPOOLED ?? "" },
  { name: "backup", connectionString: process.env.DATABASE_URL_AUDIT_BACKUP_UNPOOLED ?? "" },
  { name: "test", connectionString: process.env.DATABASE_URL_AUDIT_TEST_UNPOOLED ?? "" },
];

function validateConnection(target: Target) {
  if (!target.connectionString) throw new Error(`Missing direct connection for ${target.name}.`);
  try {
    const parsed = new URL(target.connectionString);
    if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") throw new Error("unsupported protocol");
  } catch {
    // Never include a connection value in validation errors or logs.
    throw new Error(`Invalid direct connection configuration for ${target.name}.`);
  }
}

targets.forEach(validateConnection);

function endpointFingerprint(connectionString: string) {
  const parsed = new URL(connectionString);
  return createHash("sha256").update(`${parsed.protocol}//${parsed.hostname}${parsed.pathname}`).digest("hex").slice(0, 16);
}

const results = await Promise.all(targets.map(async (target) => {
  const sql = neon(target.connectionString);
  const [result] = await sql`
    SELECT
      current_database() AS database_name,
      current_setting('neon.branch_id', true) AS branch_id,
      (SELECT count(*)::int FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name IN ('bases', 'registros', 'lotes', 'lote_registros', 'usuarios')) AS existing_table_count,
      (SELECT count(*)::int FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name IN ('eventos_auditoria', 'registros_exportacion')) AS audit_table_count,
      (SELECT count(*)::int FROM public._prisma_migrations WHERE finished_at IS NOT NULL) AS applied_migration_count,
      (SELECT count(*)::int FROM public._prisma_migrations WHERE migration_name = '20261024014500_add_audit_events' AND finished_at IS NOT NULL) AS audit_migration_count,
      (SELECT count(*)::int FROM public.bases) AS base_count,
      (SELECT count(*)::int FROM public.registros) AS record_count,
      (SELECT count(*)::int FROM public.lotes) AS lot_count
  ` as { database_name: string; branch_id: string | null; existing_table_count: number; audit_table_count: number; applied_migration_count: number; audit_migration_count: number; base_count: number; record_count: number; lot_count: number }[];
  return {
    name: target.name,
    endpointFingerprint: endpointFingerprint(target.connectionString),
    databaseName: result.database_name,
    branchId: result.branch_id,
    existingTableCount: result.existing_table_count,
    auditTableCount: result.audit_table_count,
    appliedMigrationCount: result.applied_migration_count,
    auditMigrationCount: result.audit_migration_count,
    baseCount: result.base_count,
    recordCount: result.record_count,
    lotCount: result.lot_count,
  };
}));

const uniqueEndpoints = new Set(results.map((result) => result.endpointFingerprint)).size === results.length;
const backup = results.find((result) => result.name === "backup")!;
const test = results.find((result) => result.name === "test")!;
const backupLooksPreAudit = backup.existingTableCount === 5 && backup.auditTableCount === 0 && backup.auditMigrationCount === 0;
const testReady = test.existingTableCount === 5 && test.auditTableCount === 0 && test.auditMigrationCount === 0;

console.log(JSON.stringify({ uniqueEndpoints, backupLooksPreAudit, testReady, targets: results }));
if (!uniqueEndpoints || !backupLooksPreAudit || !testReady) process.exitCode = 1;
