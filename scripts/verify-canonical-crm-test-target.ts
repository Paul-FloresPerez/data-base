import nextEnv from "@next/env";
import { Client } from "pg";

nextEnv.loadEnvConfig(process.cwd());

const connectionString = process.env.PRISMA_MIGRATION_TEST_URL;
const expectedBranchId = process.env.PRISMA_MIGRATION_TEST_BRANCH_ID;

if (!connectionString || !expectedBranchId) {
  throw new Error("La configuración dedicada de migración Test es obligatoria.");
}

const client = new Client({ connectionString });
try {
  await client.connect();
  const result = await client.query<{
    branch_id: string | null;
    migration_applied: boolean;
    global_lookup_migration_applied: boolean;
    canonical_tables_present: boolean;
    canonical_foreign_keys_present: boolean;
    canonical_indexes_present: boolean;
    legacy_tables_present: boolean;
    global_mobile_lookup_index_present: boolean;
  }>(
    `SELECT
       current_setting('neon.branch_id', true) AS branch_id,
       EXISTS (
         SELECT 1 FROM "_prisma_migrations"
         WHERE migration_name = '20261104090000_add_canonical_crm_files'
           AND finished_at IS NOT NULL
       ) AS migration_applied,
       EXISTS (
         SELECT 1 FROM "_prisma_migrations"
         WHERE migration_name = '20261104100000_add_global_crm_mobile_lookup_index'
           AND finished_at IS NOT NULL
       ) AS global_lookup_migration_applied,
       to_regclass('public.archivos_crm_canonicos') IS NOT NULL
         AND to_regclass('public.archivos_crm_bases') IS NOT NULL
         AND to_regclass('public.filas_archivos_crm') IS NOT NULL
         AS canonical_tables_present,
       (SELECT count(*) FROM pg_constraint
        WHERE contype = 'f'
          AND conrelid IN (
            'public.archivos_crm_canonicos'::regclass,
            'public.archivos_crm_bases'::regclass,
            'public.filas_archivos_crm'::regclass
          )) = 4 AS canonical_foreign_keys_present,
       to_regclass('public.archivos_crm_bases_archivo_crm_id_base_original_id_key') IS NOT NULL
         AND to_regclass('public.filas_archivos_crm_archivo_crm_id_hoja_origen_numero_fila_origen_key') IS NOT NULL
         AND to_regclass('public.filas_archivos_crm_archivo_crm_id_movil_normalizado_idx') IS NOT NULL
         AS canonical_indexes_present,
       to_regclass('public.bases') IS NOT NULL
         AND to_regclass('public.registros') IS NOT NULL
         AND to_regclass('public.lotes') IS NOT NULL
         AND to_regclass('public.lote_registros') IS NOT NULL
         AND to_regclass('public.archivos_tipificaciones') IS NOT NULL
         AND to_regclass('public.gestiones_tipificacion') IS NOT NULL
         AS legacy_tables_present,
       to_regclass('public.registros_movil_normalizado_idx') IS NOT NULL
         AS global_mobile_lookup_index_present`,
  );
  const row = result.rows[0];
  const branchId = row?.branch_id ?? null;
  const match = branchId === expectedBranchId;
  console.log(JSON.stringify({
    target: "test",
    branchId,
    expectedBranchId,
    match,
    migrationApplied: row?.migration_applied ?? false,
    globalLookupMigrationApplied: row?.global_lookup_migration_applied ?? false,
    canonicalTablesPresent: row?.canonical_tables_present ?? false,
    canonicalForeignKeysPresent: row?.canonical_foreign_keys_present ?? false,
    canonicalIndexesPresent: row?.canonical_indexes_present ?? false,
    legacyTablesPresent: row?.legacy_tables_present ?? false,
    globalMobileLookupIndexPresent: row?.global_mobile_lookup_index_present ?? false,
  }));
  if (!match) process.exitCode = 1;
} finally {
  await client.end().catch(() => undefined);
}
