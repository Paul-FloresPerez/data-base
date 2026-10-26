import assert from "node:assert/strict";
import test from "node:test";
import { indexHlrResultsByNormalizedMobile } from "../lib/services/hlr-result-linkage.ts";
import {
  mapWithDocumentedSozarContract,
  SozarResponseContractError,
  validateDocumentedSozarResponseContract,
} from "../lib/services/sozar-response-contract.ts";

const fixtureContract = {
  version: "anonymous-fixture-v1",
  returnedMobilePath: ["result", "mobile"],
  currentOperatorPath: ["result", "current"],
  originalOperatorPath: ["result", "original"],
  donorOperatorPath: ["result", "donor"],
  portabilityDatePath: ["result", "portedAt"],
} as const;

test("mapea una respuesta ficticia solo mediante rutas documentadas", () => {
  const mapped = mapWithDocumentedSozarContract("+34 612 345 678", {
    result: { mobile: "612345678", current: "Operador A", original: "Operador B", donor: "Operador C", portedAt: "2025-01-15" },
  }, fixtureContract, "2026-10-25T00:00:00.000Z");

  assert.deepEqual(mapped, {
    status: "mapped",
    result: {
      mobile: "612345678", operadorActual: "Operador A", operadorOriginal: "Operador B", operadorDonante: "Operador C", fechaPortabilidad: "2025-01-15", consultedAt: "2026-10-25T00:00:00.000Z", source: "API_REAL",
    },
  });
});

test("una respuesta ficticia incompleta deja campos no devueltos vacíos", () => {
  const mapped = mapWithDocumentedSozarContract("612345678", { result: { mobile: "612345678", current: "Operador A" } }, fixtureContract, "2026-10-25T00:00:00.000Z");
  assert.equal(mapped.status, "mapped");
  if (mapped.status === "mapped") {
    assert.equal(mapped.result.operadorActual, "Operador A");
    assert.equal(mapped.result.operadorOriginal, null);
    assert.equal(mapped.result.operadorDonante, null);
    assert.equal(mapped.result.fechaPortabilidad, null);
  }
});

test("errores y timeout ficticios no pueden atravesar la puerta de transporte", async () => {
  const { SozarHttpClient, SozarExecutionBlockedError } = await import("../lib/server/sozar-http-client.ts");
  for (const transport of [
    async () => { throw new Error("provider error fixture"); },
    async () => { const error = new Error("timeout fixture"); error.name = "AbortError"; throw error; },
  ]) {
    let calls = 0;
    const client = new SozarHttpClient({ endpointTemplate: "https://apisozarusac.com/BackendJava/api/numbers/{numero}", allowedHosts: ["apisozarusac.com"], timeoutMs: 1_000, authentication: { kind: "none" } }, async () => {
      calls += 1;
      return transport() as never;
    });
    await assert.rejects(client.lookup("612345678"), SozarExecutionBlockedError);
    assert.equal(calls, 0);
  }
});

test("rechaza una respuesta ficticia que no corresponde al móvil solicitado", () => {
  const mapped = mapWithDocumentedSozarContract("612345678", { result: { mobile: "712345678", current: "Operador A" } }, fixtureContract, "2026-10-25T00:00:00.000Z");
  assert.deepEqual(mapped, { status: "invalid_response", reason: "mobile_mismatch" });
});

test("deduplica respuestas ficticias por móvil normalizado sin depender de filas", () => {
  const first = mapWithDocumentedSozarContract("612345678", { result: { mobile: "612345678", current: "A" } }, fixtureContract, "2026-10-25T00:00:00.000Z");
  const duplicate = mapWithDocumentedSozarContract("+34 612 345 678", { result: { mobile: "612345678", current: "B" } }, fixtureContract, "2026-10-25T00:00:00.000Z");
  assert.equal(first.status, "mapped");
  assert.equal(duplicate.status, "mapped");
  if (first.status === "mapped" && duplicate.status === "mapped") {
    const index = indexHlrResultsByNormalizedMobile([first.result, duplicate.result]);
    assert.equal(index.size, 1);
    assert.equal(index.get("612345678")?.operadorActual, "A");
  }
});

test("rechaza contratos sin campos documentados y JSON de forma inválida", () => {
  assert.throws(() => validateDocumentedSozarResponseContract({ version: "v1" }), SozarResponseContractError);
  const mapped = mapWithDocumentedSozarContract("612345678", [], fixtureContract, "2026-10-25T00:00:00.000Z");
  assert.deepEqual(mapped, { status: "invalid_response", reason: "invalid_shape" });
});
