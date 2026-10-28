import assert from "node:assert/strict";
import test from "node:test";
import { SOZAR_EXECUTION_CODE_GATE } from "../lib/server/sozar-http-client.ts";
import { isSozarHlrExecutionEnabled } from "../lib/server/sozar-hlr-provider.ts";
import { getFirstRealSozarTestConfiguration, SOZAR_FIRST_REAL_TEST_CODE_GATE, SOZAR_FIRST_REAL_TEST_OPERATION_KEY } from "../lib/server/sozar-first-real-gate.ts";
import { planFirstRealSozarTest } from "../lib/server/sozar-first-real-plan.ts";
import { readFile } from "node:fs/promises";

const input = {
  baseId: "00000000-0000-4000-8000-000000000001",
  mobile: "+34 612 345 678",
  mobileFingerprintKey: "test-hmac-key",
  globalOperationAlreadyRecorded: false,
  hasReusableRealResult: false,
  existingConsultationState: null,
};

test("la prueba única y las vías compartidas siguen cerradas", () => {
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

test("la prueba única no exige ni inventa una tarifa para reservar un único móvil", () => {
  assert.equal(planFirstRealSozarTest(input).status, "LISTO");
});

test("las claves de la prueba única requieren 32 bytes en base64url antes de reservar", () => {
  const fingerprintBefore = process.env.SOZAR_MOBILE_FINGERPRINT_KEY;
  const responseBefore = process.env.SOZAR_RESPONSE_ENCRYPTION_KEY;
  try {
    process.env.SOZAR_MOBILE_FINGERPRINT_KEY = Buffer.alloc(32, 1).toString("base64url");
    process.env.SOZAR_RESPONSE_ENCRYPTION_KEY = Buffer.alloc(32, 2).toString("base64url");
    assert.equal(getFirstRealSozarTestConfiguration().mobileFingerprintKey.length, 43);
    process.env.SOZAR_RESPONSE_ENCRYPTION_KEY = "invalida";
    assert.throws(() => getFirstRealSozarTestConfiguration());
  } finally {
    if (fingerprintBefore === undefined) delete process.env.SOZAR_MOBILE_FINGERPRINT_KEY;
    else process.env.SOZAR_MOBILE_FINGERPRINT_KEY = fingerprintBefore;
    if (responseBefore === undefined) delete process.env.SOZAR_RESPONSE_ENCRYPTION_KEY;
    else process.env.SOZAR_RESPONSE_ENCRYPTION_KEY = responseBefore;
  }
});

test("un límite global, caché real o estado incierto bloquean cualquier segunda consulta", () => {
  assert.deepEqual(planFirstRealSozarTest({ ...input, globalOperationAlreadyRecorded: true }), { status: "BLOQUEADO", reason: "LIMITE_GLOBAL" });
  assert.deepEqual(planFirstRealSozarTest({ ...input, hasReusableRealResult: true }), { status: "BLOQUEADO", reason: "RESULTADO_REUTILIZABLE" });
  for (const existingConsultationState of ["PENDIENTE", "EN_CURSO", "EXITOSA", "INCIERTA", "FALLIDA"] as const) {
    assert.deepEqual(planFirstRealSozarTest({ ...input, existingConsultationState }), { status: "BLOQUEADO", reason: "COLA_EXISTENTE" });
  }
});

test("la vía excepcional queda limitada al ejecutor de prueba y la vía masiva continúa cerrada", async () => {
  const client = await readFile(new URL("../lib/server/sozar-http-client.ts", import.meta.url), "utf8");
  const executor = await readFile(new URL("../lib/server/sozar-first-real-executor.ts", import.meta.url), "utf8");
  assert.match(client, /firstRealTestTransportBrand/);
  assert.match(client, /executionScope === "first-real-test"/);
  assert.match(executor, /"first-real-test"/);
  assert.equal(SOZAR_EXECUTION_CODE_GATE, false);
  assert.equal(isSozarHlrExecutionEnabled, false);
});
