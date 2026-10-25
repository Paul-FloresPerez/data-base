import nextEnv from "@next/env";
import { neon } from "@neondatabase/serverless";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const connectionString = process.env.DATABASE_URL_UNPOOLED;
if (!connectionString) throw new Error("DATABASE_URL_UNPOOLED is required to verify the audit schema.");

const sql = neon(connectionString);
const [result] = await sql`
  SELECT
    (SELECT count(*)::int FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name IN ('eventos_auditoria', 'registros_exportacion')) AS audit_table_count,
    (SELECT count(*)::int FROM pg_indexes WHERE schemaname = 'public' AND indexname IN (
      'eventos_auditoria_operacion_id_key', 'eventos_auditoria_base_id_creado_en_idx',
      'eventos_auditoria_usuario_id_creado_en_idx', 'eventos_auditoria_campana_creado_en_idx',
      'eventos_auditoria_accion_creado_en_idx', 'registros_exportacion_operacion_id_key',
      'registros_exportacion_base_id_creado_en_idx', 'registros_exportacion_campana_creado_en_idx',
      'registros_exportacion_estado_creado_en_idx')) AS audit_index_count,
    (SELECT count(*)::int FROM information_schema.table_constraints WHERE table_schema = 'public'
      AND constraint_type = 'FOREIGN KEY' AND table_name IN ('eventos_auditoria', 'registros_exportacion')) AS audit_foreign_key_count,
    (SELECT count(*)::int FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name IN ('bases', 'registros', 'lotes', 'lote_registros', 'usuarios')) AS existing_table_count,
    (SELECT count(*)::int FROM public._prisma_migrations
      WHERE migration_name = '20261024014500_add_audit_events' AND finished_at IS NOT NULL) AS applied_migration_count
` as { audit_table_count: number; audit_index_count: number; audit_foreign_key_count: number; existing_table_count: number; applied_migration_count: number }[];

const verified = result.audit_table_count === 2 && result.audit_index_count === 9 && result.audit_foreign_key_count === 4 && result.existing_table_count === 5 && result.applied_migration_count === 1;
console.log(JSON.stringify({ verified, auditTableCount: result.audit_table_count, auditIndexCount: result.audit_index_count, auditForeignKeyCount: result.audit_foreign_key_count, existingTableCount: result.existing_table_count, appliedMigrationCount: result.applied_migration_count }));
if (!verified) process.exitCode = 1;
