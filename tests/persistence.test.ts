import assert from "node:assert/strict";
import test from "node:test";
import { getAccessDecision } from "../lib/auth/access-control.ts";
import { restoreBatch, serializeBatch, splitRecords } from "../lib/persistence/workspace-persistence.ts";
import { cleanDataset } from "../lib/excel/cleaning.ts";
import { createWorkingBatch, getProcessingModule } from "../lib/workspace/batch.ts";
import { analyzeRecyclingFiles, recyclingToBatch } from "../lib/recycling/recycling.ts";

const dataset = { fileName: "clientes.xlsx", columns: ["Móvil", "CP", "Nombre"], columnMapping: { movil: 0, nombre: 2, enriched: {} }, records: [
  { sourceRow: 2, cells: ["612345678", "01234", "Ana"], mobile: "612345678", document: "", name: "Ana", contactPhone: "" },
  { sourceRow: 3, cells: ["912345678", "00001", "Bea"], mobile: "912345678", document: "", name: "Bea", contactPhone: "" },
] };

test("serializa y recupera una base preservando los ceros y la limpieza", () => {
  const batch = createWorkingBatch(dataset, "11111111-1111-4111-8111-111111111111", "2026-10-22T00:00:00.000Z");
  batch.cleaning = cleanDataset(dataset);
  const { start, records } = serializeBatch(batch, "Clientes octubre");
  const restored = restoreBatch({ id: start.id, name: start.name, createdAt: batch.createdAt, metadata: { ...start.metadata, completed: true, revision: null }, records: records.map((record, index) => ({ ...record, id: String(index) })) });
  assert.equal(restored.dataset.records[0]?.cells[1], "01234");
  assert.equal(restored.cleaning?.validRecords.length, 1);
  assert.equal(restored.cleaning?.excludedRecords[0]?.reason, "telefono_fijo");
  assert.equal(restored.provenanceBySourceRow[2], "EXCEL");
});

test("restaura el nombre elegido y el estado de exportación guardado", () => {
  const batch = createWorkingBatch(dataset, "11111111-1111-4111-8111-111111111112", "2026-10-22T00:00:00.000Z");
  batch.exportCompletedAt = "2026-10-23T00:00:00.000Z";
  const { start, records } = serializeBatch(batch, "Cierre octubre");
  const restored = restoreBatch({ id: start.id, name: start.name, createdAt: batch.createdAt, metadata: { ...start.metadata, completed: true, revision: null }, records: records.map((record, index) => ({ ...record, id: String(index) })) });
  assert.equal(restored.displayName, "Cierre octubre");
  assert.equal(restored.exportCompletedAt, "2026-10-23T00:00:00.000Z");
});

test("guarda y recupera resultados históricos con procedencia EXCEL sin perder columnas", () => {
  const batch = createWorkingBatch(dataset, "11111111-1111-4111-8111-111111111113", "2026-10-22T00:00:00.000Z");
  batch.cleaning = cleanDataset(dataset);
  batch.enrichmentOutput = {
    columns: ["Móvil", "CP", "Nombre", "Operador Actual", "Operador Original", "Fecha Portabilidad", "Portabilidad Hacia"],
    rows: [{ sourceRow: 2, cells: ["612345678", "01234", "Ana", "Operador sintético", "Origen sintético", "2026-02-03T00:00:00Z", "Destino sintético"] }],
  };
  batch.historicalResultImport = {
    sourceFileName: "historico.xlsx",
    sourceColumns: ["Número Emitido", "Operador Actual"],
    matched: 1,
    applied: 1,
    missingForBase: 0,
    resultsWithoutBase: 0,
    invalidResults: 0,
    duplicateResults: 0,
    skippedApiReal: 0,
  };
  batch.provenanceBySourceRow[2] = "EXCEL";

  const { start, records } = serializeBatch(batch, "Histórica");
  const restored = restoreBatch({ id: start.id, name: start.name, createdAt: batch.createdAt, metadata: { ...start.metadata, completed: true, revision: null }, records: records.map((record, index) => ({ ...record, id: String(index) })) });

  assert.equal(restored.provenanceBySourceRow[2], "EXCEL");
  assert.equal(restored.historicalResultImport?.applied, 1);
  assert.equal(restored.enrichmentOutput?.columns.includes("Portabilidad Hacia"), true);
  assert.equal(restored.enrichmentOutput?.rows[0]?.cells[1], "01234");
  assert.equal(restored.enrichmentOutput?.rows[0]?.cells[6], "Destino sintético");
});

test("el guardado separa peticiones y conserva un UUID estable en reintentos", () => {
  const batch = createWorkingBatch({ ...dataset, records: Array.from({ length: 201 }, (_, index) => ({ ...dataset.records[0]!, sourceRow: index + 2 })) }, "22222222-2222-4222-8222-222222222222");
  const first = serializeBatch(batch, "Base");
  const second = serializeBatch(batch, "Base");
  assert.equal(first.start.id, second.start.id);
  assert.equal(splitRecords(first.records).length, 3);
});

test("las rutas de bases rechazan acceso anónimo", () => {
  assert.equal(getAccessDecision({ isAuthenticated: false, pathname: "/api/bases", search: "" }).type, "unauthorized");
  assert.equal(getAccessDecision({ isAuthenticated: false, pathname: "/api/bases/id/registros", search: "" }).type, "unauthorized");
});

test("restaura una base reciclada sin volver a incluir su historial en la operación", () => {
  const analysis = analyzeRecyclingFiles([{ fileName: "crm.xlsx", columns: ["Telefono Movil", "Tipificacion"], rows: [["612345678", "NO RESPONDE"], ["712345678", "AGENDADO"]] }]);
  const batch = recyclingToBatch(analysis, new Set(["NO RESPONDE"]));
  const { start, records } = serializeBatch(batch, "Reciclada");
  const restored = restoreBatch({ id: start.id, name: start.name, createdAt: batch.createdAt, metadata: { ...start.metadata, completed: true, revision: null }, records: records.map((record, index) => ({ ...record, id: String(index) })) });
  assert.equal(restored.kind, "RECICLADA");
  assert.equal(restored.dataset.records.length, 1);
  assert.equal(restored.recyclingHistory?.records.length, 1);
});

test("la navegación principal conserva la etapa válida de la base activa", () => {
  const batch = createWorkingBatch(dataset);
  assert.equal(getProcessingModule(null), "importacion");
  assert.equal(getProcessingModule(batch), "limpieza");
  batch.cleaning = cleanDataset(dataset);
  assert.equal(getProcessingModule(batch), "enriquecimiento");
  batch.enrichmentOutput = { columns: dataset.columns, rows: batch.cleaning.validRecords.map((record) => ({ sourceRow: record.sourceRow, cells: record.cells })) };
  assert.equal(getProcessingModule(batch), "campanas");
  assert.equal(getProcessingModule(batch, "exportacion"), "exportacion");
});
