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
];

test("las migraciones preparadas tienen un orden estable y son aditivas", async () => {
  const names = (await readdir(migrationRoot)).filter((name) => /^\d/.test(name)).sort();
  assert.deepEqual(names, expected);
  const sql = await Promise.all(expected.slice(2).map(async (name) =>
    readFile(new URL(`../prisma/migrations/${name}/migration.sql`, import.meta.url), "utf8"),
  ));
  for (const migration of sql) {
    assert.doesNotMatch(migration, /^\s*(DROP|TRUNCATE|DELETE\s+FROM|UPDATE\s+)/im);
  }
  assert.match(sql[0]!, /CREATE TABLE "eventos_auditoria"/);
  assert.match(sql[1]!, /CREATE TABLE "consultas_hlr"/);
  assert.match(sql[2]!, /CREATE TABLE "limites_intentos_login"/);
});
