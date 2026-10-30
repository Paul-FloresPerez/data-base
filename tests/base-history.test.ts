import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { filterHistoricalBases, formatBaseCode } from "../lib/base-history/catalog.ts";
import { createWorkingBatch } from "../lib/workspace/batch.ts";
import { restoreBatch, serializeBatch } from "../lib/persistence/workspace-persistence.ts";

const dataset = {
  fileName: "crm-historico.xlsx",
  columns: ["Móvil"],
  columnMapping: { movil: 0, enriched: {} },
  records: [{ sourceRow: 2, cells: ["612345678"], mobile: "612345678", document: "", name: "", contactPhone: "" }],
};

test("genera códigos legibles por año, mes y secuencia", () => {
  assert.equal(formatBaseCode(new Date("2024-01-15T00:00:00.000Z"), 1), "BAS-2024-01-0001");
  assert.equal(formatBaseCode(new Date("2026-10-01T00:00:00.000Z"), 27), "BAS-2026-10-0027");
  assert.throws(() => formatBaseCode(new Date("2026-10-01T00:00:00.000Z"), 0));
});

test("encuentra y filtra bases de años distintos sin usar la fecha de importación", () => {
  const bases = [
    { id: "a", code: "BAS-2023-11-0001", name: "Campaña norte", originalFileName: "crm-a.xlsx", receivedAt: "2023-11-02", state: "LISTA_PARA_DISTRIBUIR", kind: "ORIGINAL" as const, imported: 10, valid: 8, excluded: 2 },
    { id: "b", code: "BAS-2025-03-0004", name: "Seguimiento", originalFileName: "crm-b.xlsx", receivedAt: "2025-03-16", state: "LISTA_PARA_ENRIQUECER", kind: "ORIGINAL" as const, imported: 10, valid: 8, excluded: 2 },
    { id: "c", code: "BAS-2026-01-0002", name: "Reciclada", originalFileName: "BASE_RECICLADA.xlsx", receivedAt: null, state: "LISTA_PARA_DISTRIBUIR", kind: "RECICLADA" as const, imported: 10, valid: 8, excluded: 2 },
  ];
  assert.deepEqual(filterHistoricalBases(bases, { query: "2025-03" }).map((base) => base.id), ["b"]);
  assert.deepEqual(filterHistoricalBases(bases, { kind: "ORIGINAL", fromDate: "2023-01-01", toDate: "2024-12-31" }).map((base) => base.id), ["a"]);
  assert.deepEqual(filterHistoricalBases(bases, { state: "LISTA_PARA_DISTRIBUIR" }).map((base) => base.id), ["a", "c"]);
});

test("la restauración conserva fecha de recepción y vínculo manual a la base original", () => {
  const batch = createWorkingBatch(dataset, "11111111-1111-4111-8111-111111111111", "2026-10-29T00:00:00.000Z");
  batch.receivedAt = "2022-06-18";
  batch.originalBaseId = "22222222-2222-4222-8222-222222222222";
  batch.kind = "RECICLADA";
  const serialized = serializeBatch(batch, "Base reciclada");
  const restored = restoreBatch({ id: serialized.start.id, name: serialized.start.name, originalFileName: dataset.fileName, receivedAt: serialized.start.receivedAt, originalBaseId: serialized.start.originalBaseId, createdAt: batch.createdAt, metadata: { ...serialized.start.metadata, completed: true, revision: null }, records: serialized.records.map((record, index) => ({ ...record, id: String(index) })) });
  assert.equal(restored.receivedAt, "2022-06-18");
  assert.equal(restored.originalBaseId, "22222222-2222-4222-8222-222222222222");
  assert.equal(restored.dataset.records[0]?.mobile, "612345678");
});

test("conserva referencias de varios archivos de tipificaciones sin reemplazarlos", () => {
  const batch = createWorkingBatch(dataset, "11111111-1111-4111-8111-111111111112", "2026-10-29T00:00:00.000Z");
  batch.historicalResultImports = [
    { importId: "historico-a", sourceFileName: "gestiones-a.xlsx", sourceColumns: ["Número Emitido"], matched: 1, applied: 1, missingForBase: 0, resultsWithoutBase: 0, invalidResults: 0, duplicateResults: 0, skippedApiReal: 0 },
    { importId: "historico-b", sourceFileName: "gestiones-b.xlsx", sourceColumns: ["Número Emitido"], matched: 1, applied: 0, missingForBase: 0, resultsWithoutBase: 0, invalidResults: 0, duplicateResults: 0, skippedApiReal: 1 },
  ];
  batch.historicalResultImport = batch.historicalResultImports[1]!;
  const serialized = serializeBatch(batch, "Base histórica");
  const restored = restoreBatch({ id: serialized.start.id, name: serialized.start.name, createdAt: batch.createdAt, metadata: { ...serialized.start.metadata, completed: true, revision: null }, records: serialized.records.map((record, index) => ({ ...record, id: String(index) })) });
  assert.deepEqual(restored.historicalResultImports.map((item) => item.importId), ["historico-a", "historico-b"]);
  assert.equal(restored.historicalResultImport?.sourceFileName, "gestiones-b.xlsx");
});

test("la migración de catálogo es aditiva y conserva la relación de lotes", async () => {
  const migration = await readFile(new URL("../prisma/migrations/20261029090000_add_base_history_catalog/migration.sql", import.meta.url), "utf8");
  assert.match(migration, /ADD COLUMN "codigo"/);
  assert.match(migration, /ADD COLUMN "base_original_id"/);
  assert.match(migration, /CREATE TABLE "archivos_tipificaciones"/);
  assert.match(migration, /CREATE TABLE "ejecuciones_reciclaje"/);
  assert.doesNotMatch(migration, /DROP\s+(TABLE|COLUMN|TYPE)/i);
});
