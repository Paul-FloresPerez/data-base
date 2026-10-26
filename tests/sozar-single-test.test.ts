import assert from "node:assert/strict";
import test from "node:test";
import { decryptSozarResponseForMapping } from "../lib/server/sozar-response-inspection.ts";
import { simulateSingleSozarTest } from "../lib/server/sozar-single-test-simulation.ts";
import { prepareSingleSozarTest, SingleSozarTestPolicyError } from "../lib/server/sozar-single-test.ts";
import { applyRealHlrResultToEnrichmentOutput } from "../lib/services/real-hlr-application.ts";

const encryptionKey = Buffer.alloc(32, 7).toString("base64url");
const actor = { isAdministrator: true, userId: "00000000-0000-4000-8000-000000000001" };
const approval = { maxQueries: 1, budgetMaxCents: 25, maxCostPerQueryCents: 25 };
const baseRequest = {
  actor,
  baseId: "00000000-0000-4000-8000-000000000002",
  mobile: "+34 612 345 678",
  confirmation: "SOZAR_SINGLE_TEST" as const,
  approval,
  mobileFingerprintKey: "test-hmac-key",
  existing: { hasReusableRealResult: false, consultationState: null },
};
const fixtureContract = {
  version: "anonymous-fixture-v1",
  returnedMobilePath: ["result", "mobile"],
  currentOperatorPath: ["result", "current"],
  originalOperatorPath: ["result", "original"],
  donorOperatorPath: ["result", "donor"],
  portabilityDatePath: ["result", "portedAt"],
} as const;

test("la prueba administrativa solo prepara un móvil, con autorización y presupuesto explícitos", () => {
  const preflight = prepareSingleSozarTest(baseRequest);
  assert.equal(preflight.status, "LISTO_PARA_UNA_CONSULTA");
  if (preflight.status === "LISTO_PARA_UNA_CONSULTA") {
    assert.equal(preflight.mobile, "612345678");
    assert.doesNotMatch(preflight.idempotencyKey, /612345678/);
  }
  assert.throws(() => prepareSingleSozarTest({ ...baseRequest, approval: { ...approval, maxQueries: 2 } }), SingleSozarTestPolicyError);
  assert.throws(() => prepareSingleSozarTest({ ...baseRequest, actor: { ...actor, isAdministrator: false } }), SingleSozarTestPolicyError);
  assert.throws(() => prepareSingleSozarTest({ ...baseRequest, mobile: "912345678" }));
});

test("un resultado real vigente o cualquier consulta previa bloquea una segunda petición", () => {
  assert.equal(prepareSingleSozarTest({ ...baseRequest, existing: { hasReusableRealResult: true, consultationState: null } }).status, "REUTILIZAR_RESULTADO_REAL");
  for (const consultationState of ["PENDIENTE", "EN_CURSO", "EXITOSA", "INCIERTA", "FALLIDA"] as const) {
    const result = prepareSingleSozarTest({ ...baseRequest, existing: { hasReusableRealResult: false, consultationState } });
    assert.deepEqual(result.status, "BLOQUEADO_POR_CONSULTA_EXISTENTE");
  }
});

test("el recorrido simulado cifra la respuesta, inspecciona solo su estructura y mapea únicamente con contrato", async () => {
  const preflight = prepareSingleSozarTest(baseRequest);
  assert.equal(preflight.status, "LISTO_PARA_UNA_CONSULTA");
  if (preflight.status !== "LISTO_PARA_UNA_CONSULTA") return;
  let calls = 0;
  const result = await simulateSingleSozarTest(preflight, async (mobile) => {
    calls += 1;
    assert.equal(mobile, "612345678");
    return { result: { mobile, current: "A", original: "B", donor: "C", portedAt: "2026-10-25" } };
  }, encryptionKey, fixtureContract, "2026-10-25T00:00:00.000Z");
  assert.equal(calls, 1);
  assert.equal(result.status, "RESPUESTA_RECIBIDA");
  if (result.status !== "RESPUESTA_RECIBIDA") return;
  assert.deepEqual(result.inspection, { object: { result: { object: { current: "string", donor: "string", mobile: "string", original: "string", portedAt: "string" } } } });
  assert.equal(JSON.stringify(result.encryptedResponse).includes("612345678"), false);
  assert.deepEqual(decryptSozarResponseForMapping(result.encryptedResponse, encryptionKey), { result: { mobile: "612345678", current: "A", original: "B", donor: "C", portedAt: "2026-10-25" } });
  assert.equal(result.mapping.status, "mapped");
});

test("una respuesta incompleta o sin contrato no completa campos, pero queda preservada cifrada", async () => {
  const preflight = prepareSingleSozarTest(baseRequest);
  assert.equal(preflight.status, "LISTO_PARA_UNA_CONSULTA");
  if (preflight.status !== "LISTO_PARA_UNA_CONSULTA") return;
  const incomplete = await simulateSingleSozarTest(preflight, async () => ({ anything: "unknown" }), encryptionKey, null);
  assert.equal(incomplete.status, "RESPUESTA_RECIBIDA");
  if (incomplete.status === "RESPUESTA_RECIBIDA") assert.deepEqual(incomplete.mapping, { status: "documentation_required" });
});

test("timeout e incidencias simuladas quedan sin reintento automático", async () => {
  const preflight = prepareSingleSozarTest(baseRequest);
  assert.equal(preflight.status, "LISTO_PARA_UNA_CONSULTA");
  if (preflight.status !== "LISTO_PARA_UNA_CONSULTA") return;
  const timeout = await simulateSingleSozarTest(preflight, async () => { const error = new Error("fixture timeout"); error.name = "AbortError"; throw error; }, encryptionKey, null);
  assert.deepEqual(timeout, { status: "INCIERTA", retryAutomatically: false });
  const failure = await simulateSingleSozarTest(preflight, async () => { throw new Error("fixture failure"); }, encryptionKey, null);
  assert.deepEqual(failure, { status: "FALLIDA", retryAutomatically: false });
});

test("aplica una respuesta real solo al móvil correspondiente y conserva columnas y filas restantes", () => {
  const dataset = {
    fileName: "ficticio.xlsx",
    columns: ["Móvil", "Nombre", "Operador Actual", "Operador Original", "Portabilidad Desde", "Fecha Portabilidad"],
    columnMapping: { movil: 0, nombre: 1, enriched: { operador_actual: 2, operador_origen: 3, portabilidad_desde: 4, fecha_portabilidad: 5 } },
    records: [
      { sourceRow: 2, cells: ["612345678", "A", "", "", "", ""], mobile: "612345678", document: "", name: "A", contactPhone: "" },
      { sourceRow: 3, cells: ["712345678", "B", "Conservar", "Origen", "Donante", "2020-01-01"], mobile: "712345678", document: "", name: "B", contactPhone: "" },
    ],
  };
  const result = applyRealHlrResultToEnrichmentOutput({
    dataset,
    validRecords: dataset.records.map((record) => ({ ...record, normalizedMobile: record.mobile })),
    result: { mobile: "612345678", operadorActual: "Actual", operadorOriginal: "Original", operadorDonante: "Donante", fechaPortabilidad: "2026-10-25", consultedAt: "2026-10-25T00:00:00.000Z", source: "API_REAL" },
  });
  assert.deepEqual(result.updatedSourceRows, [2]);
  assert.deepEqual(result.output.rows[0]?.cells, ["612345678", "A", "Actual", "Original", "Donante", "2026-10-25", "2026", "10", "25"]);
  assert.deepEqual(result.output.rows[1]?.cells, ["712345678", "B", "Conservar", "Origen", "Donante", "2020-01-01", "2020", "01", "01"]);
});
