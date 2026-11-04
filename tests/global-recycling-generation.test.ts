import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("RG-4 vincula una sola base global y registra revalidaciones sin lotes", async () => {
  const [schema, migration, storage] = await Promise.all([
    readFile(new URL("../prisma/schema.prisma", import.meta.url), "utf8"),
    readFile(new URL("../prisma/migrations/20261104120000_add_global_recycled_base_generation/migration.sql", import.meta.url), "utf8"),
    readFile(new URL("../lib/server/global-recycling-storage.ts", import.meta.url), "utf8"),
  ]);
  assert.match(schema, /baseRecicladaId String\?\s+@unique/);
  assert.match(schema, /model ResultadoGeneracionReciclajeGlobal/);
  assert.match(migration, /ADD COLUMN "base_reciclada_id" UUID/);
  assert.match(migration, /CREATE TABLE "resultados_generaciones_reciclajes_globales"/);
  assert.doesNotMatch(migration, /^\s*(DROP|TRUNCATE|DELETE\s+FROM|UPDATE\s+)/im);
  assert.match(storage, /lockCommercialMobiles\(tx, decisions\.map/);
  assert.match(storage, /estado: "EXCLUIDO_CAMBIO"/);
  assert.match(storage, /baseRecicladaId: base\.id/);
  assert.match(storage, /version: 2/);
  assert.doesNotMatch(storage, /fetch\(|sozar/i);
});
