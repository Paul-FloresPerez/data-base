import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { getRealHlrPreview } from "../lib/services/real-hlr-preview.ts";
import { prepareDisabledRealHlrQueue } from "../lib/services/real-hlr-queue-plan.ts";
import { TestHlrProvider } from "../lib/services/test-hlr-provider.ts";
import { RealHlrProviderDisabledError, SozarHlrProvider, isSozarHlrExecutionEnabled, mapDocumentedSozarResponse } from "../lib/server/sozar-hlr-provider.ts";
import { restoreBatch, serializeBatch } from "../lib/persistence/workspace-persistence.ts";
import { createWorkingBatch } from "../lib/workspace/batch.ts";
import { indexHlrResultsByNormalizedMobile, linkHlrResultToRecord } from "../lib/services/hlr-result-linkage.ts";
import { cleanDataset, normalizeSpanishMobile } from "../lib/excel/cleaning.ts";
import { InvalidSpanishMobileForHlrError, validateSpanishMobileForSozar } from "../lib/server/sozar-hlr-provider.ts";
import {
  buildSozarRequest,
  createServerSozarFetchTransport,
  getSozarHttpConfigurationFromEnvironment,
  SozarConfigurationError,
  SozarExecutionBlockedError,
  SozarHttpClient,
  type SozarHttpConfiguration,
} from "../lib/server/sozar-http-client.ts";
import { fingerprintHlrMobile, HlrApprovalLimitError, validateHlrApprovalLimit } from "../lib/server/sozar-control-plane.ts";

const sozarConfiguration: SozarHttpConfiguration = {
  endpointTemplate: "https://apisozarusac.com/BackendJava/api/numbers/{numero}",
  allowedHosts: ["apisozarusac.com"],
  timeoutMs: 10_000,
  authentication: { kind: "header", headerName: "x-test-key", secret: "test-only-secret" },
};

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

test("el cliente HTTP queda bloqueado antes del transporte y valida su configuración", async () => {
  let transportCalls = 0;
  const client = new SozarHttpClient(sozarConfiguration, async () => {
    transportCalls += 1;
    return { ok: true, status: 200, json: async () => ({}) };
  });

  const request = buildSozarRequest(sozarConfiguration, "+34 612 345 678");
  assert.match(request.url, /\/612345678$/);
  assert.equal(new Headers(request.init.headers).get("x-test-key"), "test-only-secret");
  await assert.rejects(client.lookup("612345678"), SozarExecutionBlockedError);
  assert.equal(transportCalls, 0);
  assert.throws(() => createServerSozarFetchTransport(), SozarExecutionBlockedError);
  assert.throws(
    () => buildSozarRequest({ ...sozarConfiguration, endpointTemplate: "http://apisozarusac.com/{numero}" }, "612345678"),
    SozarConfigurationError,
  );
  assert.throws(
    () => buildSozarRequest({ ...sozarConfiguration, endpointTemplate: "https://untrusted.example/{numero}" }, "612345678"),
    SozarConfigurationError,
  );
  assert.throws(() => buildSozarRequest(sozarConfiguration, "912345678"), InvalidSpanishMobileForHlrError);
});

test("la configuración de entorno no puede abrir la puerta de ejecución", () => {
  const configuration = getSozarHttpConfigurationFromEnvironment();
  assert.equal(configuration.allowedHosts.includes("apisozarusac.com"), true);
  assert.equal(configuration.endpointTemplate.includes("{numero}"), true);
});

test("el plano de control usa huellas sin aceptar presupuestos implícitos", () => {
  const fingerprint = fingerprintHlrMobile("0034 612 345 678", "test-hmac-secret");
  assert.match(fingerprint, /^[A-Za-z0-9_-]{40,}$/);
  assert.equal(fingerprint, fingerprintHlrMobile("612345678", "test-hmac-secret"));
  assert.notEqual(fingerprint, fingerprintHlrMobile("612345678", "different-test-hmac-secret"));
  assert.deepEqual(validateHlrApprovalLimit({ maxQueries: 1, budgetMaxCents: 25, maxCostPerQueryCents: 25 }), { maxQueries: 1, budgetMaxCents: 25, maxCostPerQueryCents: 25 });
  assert.throws(() => validateHlrApprovalLimit({ maxQueries: 1, budgetMaxCents: 0, maxCostPerQueryCents: 0 }), HlrApprovalLimitError);
  assert.throws(() => validateHlrApprovalLimit({ maxQueries: 2, budgetMaxCents: 20, maxCostPerQueryCents: 21 }), HlrApprovalLimitError);
});

test("la reserva persistente queda cerrada antes de tocar Prisma", async () => {
  const source = await readFile(new URL("../lib/server/sozar-queue-repository.ts", import.meta.url), "utf8");
  assert.ok(source.indexOf("if (!SOZAR_EXECUTION_CODE_GATE)") < source.indexOf("$queryRaw"));
  assert.doesNotMatch(source, /INCIERTA[^]*?WHERE consulta\.estado = 'INCIERTA'/);
});

test("solo admite móviles españoles válidos antes de llegar al proveedor", async () => {
  assert.equal(normalizeSpanishMobile("+34 612 345 678"), "612345678");
  assert.equal(normalizeSpanishMobile("0034-712-345-678"), "712345678");
  assert.equal(normalizeSpanishMobile("612345678"), "612345678");
  for (const invalid of ["912345678", "812345678", "12345678Z", "", "61234567", "6123456780"]) {
    assert.equal(normalizeSpanishMobile(invalid), null, invalid);
    assert.throws(() => validateSpanishMobileForSozar(invalid), InvalidSpanishMobileForHlrError);
  }
  await assert.rejects(new SozarHlrProvider().lookup("+34 612 345 678"), RealHlrProviderDisabledError);
});

test("la limpieza usa solo la columna móvil y separa fijos, inválidos y duplicados", () => {
  const result = cleanDataset({
    fileName: "formatos.xlsx",
    columns: ["Teléfono Movil", "DNI", "Nombre"],
    columnMapping: { movil: 0, documento: 1, nombre: 2, enriched: {} },
    records: [
      { sourceRow: 2, cells: ["+34 612 345 678", "X123", "Ana"], mobile: "+34 612 345 678", document: "X123", name: "Ana", contactPhone: "" },
      { sourceRow: 3, cells: ["0034-712-345-678", "Y456", "Bea"], mobile: "0034-712-345-678", document: "Y456", name: "Bea", contactPhone: "" },
      { sourceRow: 4, cells: ["912345678", "612345678", "Cia"], mobile: "912345678", document: "612345678", name: "Cia", contactPhone: "" },
      { sourceRow: 5, cells: ["812345678", "Z789", "Dani"], mobile: "812345678", document: "Z789", name: "Dani", contactPhone: "" },
      { sourceRow: 6, cells: ["12345678Z", "612345678", "Eva"], mobile: "12345678Z", document: "612345678", name: "Eva", contactPhone: "" },
      { sourceRow: 7, cells: ["", "612345678", "Fran"], mobile: "", document: "612345678", name: "Fran", contactPhone: "" },
      { sourceRow: 8, cells: ["612 345 678", "G012", "Gus"], mobile: "612 345 678", document: "G012", name: "Gus", contactPhone: "" },
    ],
  });
  assert.deepEqual(result.validRecords.map((record) => record.normalizedMobile), ["612345678", "712345678"]);
  assert.deepEqual(result.reasonBreakdown, { telefono_vacio: 1, telefono_fijo: 2, telefono_invalido: 1, nombre_vacio: 0, telefono_duplicado: 1 });
});

test("el proveedor de prueba usa el mismo contrato sin acceso de red", async () => {
  const result = await new TestHlrProvider().lookup("612345678");
  assert.equal(result.source, "TEST");
  assert.equal(result.operadorActual, "Operador de prueba A");
  assert.equal(result.operadorDonante, "Operador de prueba B");
  assert.equal(result.consultedAt, "2024-01-15T00:00:00.000Z");
});

test("la previsualización separa datos reales, existentes y pendientes", () => {
  const preview = getRealHlrPreview(cleaning, dataset, { 2: "EXCEL", 3: "API_REAL" });
  assert.deepEqual(preview, { validRecords: 2, uniqueMobiles: 2, fixedExcluded: 0, invalidExcluded: 0, duplicateExcluded: 0, enrichedByRealApi: 1, enrichedFromExistingData: 0, pendingQueries: 1 });
});

test("la cola bloqueada es idempotente y se identifica por móvil normalizado", () => {
  const first = prepareDisabledRealHlrQueue({ baseId: "11111111-1111-4111-8111-111111111111", records, maxQueries: 100, budgetLimit: 0, preparedAt: "2026-10-23T00:00:00.000Z" });
  const second = prepareDisabledRealHlrQueue({ baseId: "11111111-1111-4111-8111-111111111111", records, maxQueries: 100, budgetLimit: 0, preparedAt: "2026-10-23T00:00:00.000Z" });
  assert.deepEqual(first.jobs, second.jobs);
  assert.equal(first.status, "PREPARADA_BLOQUEADA");
  assert.equal(first.jobs[0]?.normalizedMobile, "612345678");
  assert.equal("sourceRow" in (first.jobs[0] ?? {}), false);
  assert.match(first.jobs[0]?.idempotencyKey ?? "", /sozar:v2:612345678$/);
  assert.throws(() => prepareDisabledRealHlrQueue({ baseId: "11111111-1111-4111-8111-111111111111", records: [{ ...records[0]!, normalizedMobile: "912345678" }], maxQueries: 1, budgetLimit: 0 }), /solo admite móviles españoles/i);
});

test("seleccionar los diez mil móviles pendientes solo prepara una cola local bloqueada", () => {
  const syntheticRecords = Array.from({ length: 10_000 }, (_, index) => {
    const mobile = `6${String(index).padStart(8, "0")}`;
    return {
      sourceRow: index + 2,
      cells: [mobile],
      mobile,
      document: "",
      name: "",
      contactPhone: "",
      normalizedMobile: mobile,
    };
  });
  const plan = prepareDisabledRealHlrQueue({
    baseId: "11111111-1111-4111-8111-111111111111",
    records: syntheticRecords,
    maxQueries: syntheticRecords.length,
    budgetLimit: 0,
  });

  assert.equal(plan.status, "PREPARADA_BLOQUEADA");
  assert.equal(plan.jobs.length, 10_000);
  assert.equal(plan.jobs.every((job) => job.status === "PENDIENTE_APROBACION"), true);
  assert.equal(plan.jobs.some((job) => "sourceRow" in job), false);
});

test("la selección Todos no reutiliza la ruta ni el permiso excepcional de la prueba individual", async () => {
  const workspace = await readFile(new URL("../components/excel-workspace.tsx", import.meta.url), "utf8");
  const selectionStart = workspace.indexOf("function prepareAllRealHlrSelection()");
  const selectionEnd = workspace.indexOf("async function executeSingleRealHlrTest()", selectionStart);
  const selectionSource = workspace.slice(selectionStart, selectionEnd);
  const executionSource = workspace.slice(selectionEnd, workspace.indexOf("function updateCampaignFilters", selectionEnd));

  assert.ok(selectionStart >= 0 && selectionEnd > selectionStart);
  assert.match(selectionSource, /prepareDisabledRealHlrQueue/);
  assert.doesNotMatch(selectionSource, /\bfetch\s*\(/);
  assert.match(executionSource, /firstRealSozarTestUiEnabled/);
  assert.match(executionSource, /hasPreparedSingleHlrSelection/);
});

test("los resultados futuros se vinculan por móvil normalizado y no por fila", async () => {
  const result = await new TestHlrProvider().lookup("712345678");
  const indexed = indexHlrResultsByNormalizedMobile([result]);
  assert.equal(linkHlrResultToRecord(records[1]!, indexed)?.mobile, "712345678");
  assert.equal(linkHlrResultToRecord(records[0]!, indexed), null);
});

test("la cola bloqueada se conserva en el guardado de la base", () => {
  const batch = createWorkingBatch(dataset, "11111111-1111-4111-8111-111111111111", "2026-10-23T00:00:00.000Z");
  batch.cleaning = cleaning;
  batch.realHlrQueue = prepareDisabledRealHlrQueue({ baseId: batch.id, records, maxQueries: 1, budgetLimit: 0, preparedAt: "2026-10-23T00:00:00.000Z" });
  const serialized = serializeBatch(batch, "Prueba");
  const restored = restoreBatch({ id: serialized.start.id, name: serialized.start.name, createdAt: batch.createdAt, metadata: { ...serialized.start.metadata, completed: true, revision: null }, records: serialized.records.map((record, index) => ({ ...record, id: String(index) })) });
  assert.deepEqual(restored.realHlrQueue, batch.realHlrQueue);
});
