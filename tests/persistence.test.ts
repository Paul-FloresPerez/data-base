import assert from "node:assert/strict";
import test from "node:test";
import { getAccessDecision } from "../lib/auth/access-control.ts";
import { restoreBatch, serializeBatch, splitRecords } from "../lib/persistence/workspace-persistence.ts";
import { cleanDataset } from "../lib/excel/cleaning.ts";
import { createWorkingBatch } from "../lib/workspace/batch.ts";

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
