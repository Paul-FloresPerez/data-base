import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("RG-3 conserva decisiones globales inmutables sin integrar Sozar", async () => {
  const [schema, migration, storage] = await Promise.all([
    readFile(new URL("../prisma/schema.prisma", import.meta.url), "utf8"),
    readFile(new URL("../prisma/migrations/20261104110000_add_global_recycling_execution/migration.sql", import.meta.url), "utf8"),
    readFile(new URL("../lib/server/global-recycling-storage.ts", import.meta.url), "utf8"),
  ]);
  assert.match(schema, /model EjecucionReciclajeGlobal/);
  assert.match(schema, /model DecisionEjecucionReciclajeGlobal[\s\S]*?@@unique\(\[ejecucionId, movilNormalizado\]\)/);
  assert.match(migration, /CREATE TABLE "ejecuciones_reciclajes_globales"/);
  assert.match(migration, /CREATE TABLE "decisiones_ejecuciones_reciclajes_globales"/);
  assert.doesNotMatch(migration, /^\s*(DROP|TRUNCATE|DELETE\s+FROM|UPDATE\s+)/im);
  assert.match(storage, /estado: "EVALUANDO"/);
  assert.match(storage, /skipDuplicates: true/);
  assert.doesNotMatch(storage, /sozar|fetch\(/i);
});
