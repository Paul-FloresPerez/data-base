import nextEnv from "@next/env";
import { neon } from "@neondatabase/serverless";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const connectionString = process.env.DATABASE_URL_UNPOOLED;

if (!connectionString) {
  throw new Error("DATABASE_URL_UNPOOLED is required to verify the schema.");
}

const sql = neon(connectionString);
const [schema] = (await sql`
  SELECT
    (SELECT count(*)::int
     FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_name IN ('bases', 'registros', 'lotes', 'lote_registros', 'usuarios'))
      AS application_table_count,
    (SELECT count(*)::int
     FROM information_schema.table_constraints
     WHERE table_schema = 'public'
       AND constraint_type = 'FOREIGN KEY'
       AND table_name IN ('registros', 'lotes', 'lote_registros'))
      AS foreign_key_count,
    (SELECT count(*)::int
     FROM information_schema.table_constraints
     WHERE table_schema = 'public'
       AND constraint_type = 'PRIMARY KEY'
       AND table_name IN ('bases', 'registros', 'lotes', 'lote_registros', 'usuarios'))
      AS primary_key_count,
    (SELECT count(*)::int
     FROM pg_indexes
     WHERE schemaname = 'public'
       AND indexname IN (
         'registros_base_id_numero_fila_original_key',
         'lotes_base_id_campana_numero_lote_key',
         'usuarios_username_key'
       )
       AND indexdef LIKE 'CREATE UNIQUE INDEX%')
      AS unique_index_count,
    (SELECT count(*)::int FROM public._prisma_migrations)
      AS migration_count
`) as {
  application_table_count: number;
  foreign_key_count: number;
  primary_key_count: number;
  unique_index_count: number;
  migration_count: number;
}[];

const verified =
  schema.application_table_count === 5 &&
  schema.foreign_key_count === 4 &&
  schema.primary_key_count === 5 &&
  schema.unique_index_count === 3 &&
  schema.migration_count >= 2;

console.log(
  JSON.stringify({
    verified,
    applicationTableCount: schema.application_table_count,
    foreignKeyCount: schema.foreign_key_count,
    primaryKeyCount: schema.primary_key_count,
    uniqueIndexCount: schema.unique_index_count,
    migrationCount: schema.migration_count,
  })
);

if (!verified) {
  process.exitCode = 1;
}
