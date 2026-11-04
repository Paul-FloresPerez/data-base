import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

const migrationRoot = new URL("../prisma/migrations/", import.meta.url);
const expected = [
  "20261021190443_add_usuarios",
  "20261021233017_init_excel_bases",
  "20261024014500_add_audit_events",
  "20261026090000_add_sozar_hlr_control_plane",
  "20261026090100_add_shared_login_rate_limits",
  "20261029090000_add_base_history_catalog",
  "20261030090000_add_intelligent_recycling_history",
  "20261031090000_add_recycling_execution_author",
  "20261101090000_add_external_sales_blocks",
  "20261101110000_add_commercial_reservations",
  "20261101120000_add_processing_jobs",
  "20261104090000_add_canonical_crm_files",
  "20261104100000_add_global_crm_mobile_lookup_index",
  "20261104110000_add_global_recycling_execution",
  "20261104120000_add_global_recycled_base_generation",
  "20261105090000_add_base_logical_archive",
];

test("las migraciones preparadas tienen un orden estable y son aditivas", async () => {
  const names = (await readdir(migrationRoot)).filter((name) => /^\d/.test(name)).sort();
  assert.deepEqual(names, expected);
  const sql = await Promise.all(expected.slice(2).map(async (name) =>
    readFile(new URL(`../prisma/migrations/${name}/migration.sql`, import.meta.url), "utf8"),
  ));
  // The historical catalogue intentionally backfills legacy rows. Every
  // subsequent migration must stay add-only without data rewrites.
  // Earlier history migrations legitimately backfilled pre-existing rows. New
  // migrations from this point forward must be strictly add-only.
  for (const migration of sql.slice(6)) {
    assert.doesNotMatch(migration, /^\s*(DROP|TRUNCATE|DELETE\s+FROM|UPDATE\s+)/im);
  }
  assert.match(sql[0]!, /CREATE TABLE "eventos_auditoria"/);
  assert.match(sql[1]!, /CREATE TABLE "consultas_hlr"/);
  assert.match(sql[2]!, /CREATE TABLE "limites_intentos_login"/);
  assert.match(sql[3]!, /CREATE TABLE "archivos_tipificaciones"/);
  assert.doesNotMatch(sql[3]!, /^\s*(DROP|TRUNCATE|DELETE\s+FROM)/im);
  assert.match(sql[4]!, /CREATE TABLE "gestiones_tipificacion"/);
  assert.match(sql[4]!, /CREATE TABLE "resultados_ejecuciones_reciclaje"/);
  assert.doesNotMatch(sql[4]!, /^\s*(DROP|TRUNCATE|DELETE\s+FROM)/im);
  assert.match(sql[5]!, /ADD COLUMN "usuario_id" UUID/);
  assert.doesNotMatch(sql[5]!, /^\s*(DROP|TRUNCATE|DELETE\s+FROM|UPDATE\s+)/im);
  assert.match(sql[6]!, /CREATE TABLE "ventas_externas"/);
  assert.match(sql[6]!, /huella_contenido/);
  assert.doesNotMatch(sql[6]!, /^\s*(DROP|TRUNCATE|DELETE\s+FROM|UPDATE\s+)/im);
  assert.match(sql[7]!, /CREATE TABLE "reservas_comerciales"/);
  assert.match(sql[7]!, /WHERE "estado" = 'ACTIVA'/);
  assert.doesNotMatch(sql[7]!, /^\s*(DROP|TRUNCATE|DELETE\s+FROM|UPDATE\s+)/im);
  assert.match(sql[8]!, /CREATE TABLE "trabajos_procesamiento"/);
  assert.match(sql[8]!, /CREATE TABLE "bloques_trabajos_procesamiento"/);
  assert.doesNotMatch(sql[8]!, /^\s*(DROP|TRUNCATE|DELETE\s+FROM|UPDATE\s+)/im);
  assert.match(sql[9]!, /CREATE TABLE "archivos_crm_canonicos"/);
  assert.match(sql[9]!, /CREATE TABLE "archivos_crm_bases"/);
  assert.match(sql[9]!, /CREATE TABLE "filas_archivos_crm"/);
  assert.doesNotMatch(sql[9]!, /^\s*(DROP|TRUNCATE|DELETE\s+FROM|UPDATE\s+)/im);
  assert.match(sql[10]!, /CREATE INDEX "registros_movil_normalizado_idx"/);
  assert.doesNotMatch(sql[10]!, /^\s*(DROP|TRUNCATE|DELETE\s+FROM|UPDATE\s+)/im);
  assert.match(sql[11]!, /CREATE TABLE "ejecuciones_reciclajes_globales"/);
  assert.match(sql[11]!, /CREATE TABLE "decisiones_ejecuciones_reciclajes_globales"/);
  assert.doesNotMatch(sql[11]!, /^\s*(DROP|TRUNCATE|DELETE\s+FROM|UPDATE\s+)/im);
  assert.match(sql[12]!, /CREATE TABLE "resultados_generaciones_reciclajes_globales"/);
  assert.match(sql[12]!, /ADD COLUMN "base_reciclada_id" UUID/);
  assert.doesNotMatch(sql[12]!, /^\s*(DROP|TRUNCATE|DELETE\s+FROM|UPDATE\s+)/im);
  assert.match(sql[13]!, /ADD COLUMN "archivada_en"/);
  assert.match(sql[13]!, /BASE_ARCHIVADA/);
  assert.doesNotMatch(sql[13]!, /^\s*(DROP|TRUNCATE|DELETE\s+FROM|UPDATE\s+)/im);
});
