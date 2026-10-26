import assert from "node:assert/strict";
import test from "node:test";
import { SOZAR_EXECUTION_CODE_GATE } from "../lib/server/sozar-http-client.ts";
import { isSozarHlrExecutionEnabled } from "../lib/server/sozar-hlr-provider.ts";
import { SOZAR_FIRST_REAL_TEST_CODE_GATE, SOZAR_FIRST_REAL_TEST_OPERATION_KEY } from "../lib/server/sozar-first-real-gate.ts";
import { planFirstRealSozarTest } from "../lib/server/sozar-first-real-plan.ts";

const input = {
  baseId: "00000000-0000-4000-8000-000000000001",
  mobile: "+34 612 345 678",
  mobileFingerprintKey: "test-hmac-key",
  maxCostCents: 25,
  globalOperationAlreadyRecorded: false,
  hasReusableRealResult: false,
  existingConsultationState: null,
};

test("la prueba real exige tres puertas de código cerradas", () => {
  assert.equal(SOZAR_FIRST_REAL_TEST_CODE_GATE, false);
  assert.equal(SOZAR_EXECUTION_CODE_GATE, false);
  assert.equal(isSozarHlrExecutionEnabled, false);
});

test("el plan controla exactamente un móvil y una clave global persistente", () => {
  const plan = planFirstRealSozarTest(input);
  assert.equal(plan.status, "LISTO");
  if (plan.status === "LISTO") {
    assert.equal(plan.mobile, "612345678");
    assert.equal(plan.operationKey, SOZAR_FIRST_REAL_TEST_OPERATION_KEY);
    assert.doesNotMatch(plan.idempotencyKey, /612345678/);
  }
});

test("un límite global, caché real o estado incierto bloquean cualquier segunda consulta", () => {
  assert.deepEqual(planFirstRealSozarTest({ ...input, globalOperationAlreadyRecorded: true }), { status: "BLOQUEADO", reason: "LIMITE_GLOBAL" });
  assert.deepEqual(planFirstRealSozarTest({ ...input, hasReusableRealResult: true }), { status: "BLOQUEADO", reason: "RESULTADO_REUTILIZABLE" });
  for (const existingConsultationState of ["PENDIENTE", "EN_CURSO", "EXITOSA", "INCIERTA", "FALLIDA"] as const) {
    assert.deepEqual(planFirstRealSozarTest({ ...input, existingConsultationState }), { status: "BLOQUEADO", reason: "COLA_EXISTENTE" });
  }
});
