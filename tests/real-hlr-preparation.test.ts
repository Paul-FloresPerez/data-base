import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { getRealHlrPreview } from "../lib/services/real-hlr-preview.ts";
import { prepareDisabledRealHlrQueue } from "../lib/services/real-hlr-queue-plan.ts";
import { TestHlrProvider } from "../lib/services/test-hlr-provider.ts";
import { RealHlrProviderDisabledError, SozarHlrProvider, isSozarHlrExecutionEnabled, mapDocumentedSozarResponse } from "../lib/server/sozar-hlr-provider.ts";
import { restoreBatch, serializeBatch } from "../lib/persistence/workspace-persistence.ts";
import { createWorkingBatch } from "../lib/workspace/batch.ts";

const records = [
  { sourceRow: 2, cells: ["612345678", "Ana", "", ""], mobile: "612345678", document: "", name: "Ana", contactPhone: "", normalizedMobile: "612345678" },
  { sourceRow: 3, cells: ["712345678", "Bea", "Operador A", "Operador B"], mobile: "712345678", document: "", name: "Bea", contactPhone: "", normalizedMobile: "712345678" },
];
const dataset = { fileName: "prueba.xlsx", columns: ["Móvil", "Nombre", "Operador Actual", "Operador Original"], columnMapping: { movil: 0, nombre: 1, enriched: { operador_actual: 2, operador_origen: 3 } }, records: records.map(({ normalizedMobile, ...record }) => { void normalizedMobile; return record; }) };
const cleaning = { validRecords: records, excludedRecords: [], reasonBreakdown: { telefono_vacio: 0, telefono_fijo: 0, telefono_invalido: 0, nombre_vacio: 0, telefono_duplicado: 0 } };

test("el proveedor real está bloqueado antes de cualquier transporte", async () => {
  assert.equal(isSozarHlrExecutionEnabled, false);
  await assert.rejects(new SozarHlrProvider().lookup("612345678"), RealHlrProviderDisabledError);
  const source = await readFile(new URL("../lib/server/sozar-hlr-provider.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /\bfetch\s*\(/);
  assert.deepEqual(mapDocumentedSozarResponse("612345678", { arbitrary: "value" }), { status: "documentation_required" });
});

test("el proveedor de prueba usa el mismo contrato sin acceso de red", async () => {
  const result = await new TestHlrProvider().lookup("612345678");
  assert.equal(result.source, "TEST");
  assert.equal(result.operadorActual, "Operador de prueba A");
  assert.equal(result.operadorDonante, "Operador de prueba B");
});

test("la previsualización separa datos reales, existentes y pendientes", () => {
  const preview = getRealHlrPreview(cleaning, dataset, { 2: "EXCEL", 3: "API_REAL" });
  assert.deepEqual(preview, { validRecords: 2, uniqueMobiles: 2, enrichedByRealApi: 1, enrichedFromExistingData: 0, pendingQueries: 1 });
});

test("la cola bloqueada es idempotente y no conserva móviles", () => {
  const first = prepareDisabledRealHlrQueue({ baseId: "11111111-1111-4111-8111-111111111111", records, maxQueries: 100, budgetLimit: 0, preparedAt: "2026-10-23T00:00:00.000Z" });
  const second = prepareDisabledRealHlrQueue({ baseId: "11111111-1111-4111-8111-111111111111", records, maxQueries: 100, budgetLimit: 0, preparedAt: "2026-10-23T00:00:00.000Z" });
  assert.deepEqual(first.jobs, second.jobs);
  assert.equal(first.status, "PREPARADA_BLOQUEADA");
  assert.equal(JSON.stringify(first.jobs).includes("612345678"), false);
});

test("la cola bloqueada se conserva en el guardado de la base", () => {
  const batch = createWorkingBatch(dataset, "11111111-1111-4111-8111-111111111111", "2026-10-23T00:00:00.000Z");
  batch.cleaning = cleaning;
  batch.realHlrQueue = prepareDisabledRealHlrQueue({ baseId: batch.id, records, maxQueries: 1, budgetLimit: 0, preparedAt: "2026-10-23T00:00:00.000Z" });
  const serialized = serializeBatch(batch, "Prueba");
  const restored = restoreBatch({ id: serialized.start.id, name: serialized.start.name, createdAt: batch.createdAt, metadata: { ...serialized.start.metadata, completed: true, revision: null }, records: serialized.records.map((record, index) => ({ ...record, id: String(index) })) });
  assert.deepEqual(restored.realHlrQueue, batch.realHlrQueue);
});
