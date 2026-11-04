import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("RG-1 mantiene el vínculo histórico y añade el modelo CRM canónico", async () => {
  const [schema, sql] = await Promise.all([
    readFile(new URL("../prisma/schema.prisma", import.meta.url), "utf8"),
    readFile(new URL("../prisma/migrations/20261104090000_add_canonical_crm_files/migration.sql", import.meta.url), "utf8"),
  ]);

  assert.match(schema, /model ArchivoTipificaciones[\s\S]*?baseId\s+String/);
  assert.match(schema, /importacionId\s+String\s+@unique/);
  assert.match(schema, /model ArchivoCrmBase[\s\S]*?@@unique\(\[archivoCrmId, baseOriginalId\]\)/);
  assert.match(schema, /model FilaArchivoCrm[\s\S]*?@@unique\(\[archivoCrmId, hojaOrigen, numeroFilaOrigen\]\)/);
  assert.match(sql, /CREATE TABLE "archivos_crm_canonicos"/);
  assert.match(sql, /CREATE TABLE "archivos_crm_bases"/);
  assert.match(sql, /CREATE TABLE "filas_archivos_crm"/);
  assert.doesNotMatch(sql, /^\s*(DROP|TRUNCATE|DELETE\s+FROM|UPDATE\s+)/im);
});
