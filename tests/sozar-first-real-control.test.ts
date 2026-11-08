import assert from "node:assert/strict";
import test from "node:test";
import { createServerSozarFetchTransport, createServerSozarFirstRealTestFetchTransport, SOZAR_EXECUTION_CODE_GATE, SozarExecutionBlockedError, SozarHttpClient } from "../lib/server/sozar-http-client.ts";
import { isSozarHlrExecutionEnabled } from "../lib/server/sozar-hlr-provider.ts";
import { getFirstRealSozarAttemptPolicy, getFirstRealSozarTestConfiguration, SOZAR_FIRST_REAL_TEST_CODE_GATE } from "../lib/server/sozar-first-real-gate.ts";
import { planFirstRealSozarTest } from "../lib/server/sozar-first-real-plan.ts";
import { getFirstRealSozarUiReadiness } from "../lib/services/sozar-first-real-ui-readiness.ts";
import { readFile } from "node:fs/promises";

const input = {
  baseId: "00000000-0000-4000-8000-000000000001",
  mobile: "+34 612 345 678",
  mobileFingerprintKey: "test-hmac-key",
  attemptLimitReached: false,
  hasReusableRealResult: false,
  existingConsultationState: null,
};

test("la prueba única queda habilitada sin abrir las vías compartidas", () => {
  assert.equal(SOZAR_FIRST_REAL_TEST_CODE_GATE, true);
  assert.equal(SOZAR_EXECUTION_CODE_GATE, false);
  assert.equal(isSozarHlrExecutionEnabled, false);
});

test("el transporte dedicado permite una sola simulación y el transporte compartido sigue bloqueado", async () => {
  const fetchBefore = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    calls += 1;
    assert.equal(init?.method, "GET");
    return new Response(JSON.stringify({ provider: "simulated" }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  try {
    const client = new SozarHttpClient({
      endpointTemplate: "https://apisozarusac.com/BackendJava/api/numbers/{numero}",
      allowedHosts: ["apisozarusac.com"],
      timeoutMs: 1_000,
      authentication: { kind: "none" },
    }, createServerSozarFirstRealTestFetchTransport(), "first-real-test");
    assert.deepEqual(await client.lookupRaw("612345678"), { provider: "simulated" });
    assert.equal(calls, 1);
    assert.throws(() => createServerSozarFetchTransport(), SozarExecutionBlockedError);
  } finally {
    globalThis.fetch = fetchBefore;
  }
});

test("errores de transporte, timeout y JSON inválido no habilitan reintentos automáticos", async () => {
  const fetchBefore = globalThis.fetch;
  const client = () => new SozarHttpClient({
    endpointTemplate: "https://apisozarusac.com/BackendJava/api/numbers/{numero}",
    allowedHosts: ["apisozarusac.com"],
    timeoutMs: 1_000,
    authentication: { kind: "none" },
  }, createServerSozarFirstRealTestFetchTransport(), "first-real-test");
  try {
    for (const response of [
      async () => { throw new Error("transport fixture"); },
      async () => { const error = new Error("timeout fixture"); error.name = "AbortError"; throw error; },
      async () => new Response("not json", { status: 200, headers: { "content-type": "application/json" } }),
    ]) {
      globalThis.fetch = response as typeof fetch;
      await assert.rejects(client().lookupRaw("612345678"));
    }
  } finally {
    globalThis.fetch = fetchBefore;
  }
});

test("el plan controla exactamente un móvil y una clave de idempotencia sin datos personales", () => {
  const plan = planFirstRealSozarTest(input);
  assert.equal(plan.status, "LISTO");
  if (plan.status === "LISTO") {
    assert.equal(plan.mobile, "612345678");
    assert.doesNotMatch(plan.idempotencyKey, /612345678/);
  }
});

test("la prueba única no exige ni inventa una tarifa para reservar un único móvil", () => {
  assert.equal(planFirstRealSozarTest(input).status, "LISTO");
});

test("una ampliación del límite exige presupuesto y coste explícitos", () => {
  const prior = {
    max: process.env.SOZAR_FIRST_REAL_MAX_ATTEMPTS,
    budget: process.env.SOZAR_FIRST_REAL_BUDGET_CENTS,
    cost: process.env.SOZAR_FIRST_REAL_MAX_COST_CENTS,
  };
  try {
    process.env.SOZAR_FIRST_REAL_MAX_ATTEMPTS = "2";
    delete process.env.SOZAR_FIRST_REAL_BUDGET_CENTS;
    delete process.env.SOZAR_FIRST_REAL_MAX_COST_CENTS;
    assert.throws(() => getFirstRealSozarAttemptPolicy(), /presupuesto/i);
    process.env.SOZAR_FIRST_REAL_BUDGET_CENTS = "200";
    process.env.SOZAR_FIRST_REAL_MAX_COST_CENTS = "100";
    assert.deepEqual(getFirstRealSozarAttemptPolicy(), { maxAttempts: 2, budgetMaxCents: 200, maxCostPerAttemptCents: 100 });
  } finally {
    for (const [key, value] of Object.entries({
      SOZAR_FIRST_REAL_MAX_ATTEMPTS: prior.max,
      SOZAR_FIRST_REAL_BUDGET_CENTS: prior.budget,
      SOZAR_FIRST_REAL_MAX_COST_CENTS: prior.cost,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("la interfaz explica el guardado pendiente y solo habilita la prueba con preflight persistente", () => {
  const base = {
    uiGateEnabled: true,
    isInEnrichment: true,
    hasPreview: true,
    serverReady: true,
    serverIssue: null,
    globalStatus: "SIN_PRUEBA_REAL",
    hasPreparedSingleSelection: true,
    hasExplicitConfirmation: true,
    isExecuting: false,
  } as const;
  assert.match(getFirstRealSozarUiReadiness({ ...base, saveState: "saving" }).reason ?? "", /se está guardando/i);
  assert.match(getFirstRealSozarUiReadiness({ ...base, saveState: "error" }).reason ?? "", /Guarda la base ORIGINAL/i);
  assert.deepEqual(getFirstRealSozarUiReadiness({ ...base, saveState: "saved" }), { canExecute: true, reason: null });
});

test("la interfaz conserva bloqueos de selección, API real y reserva global", () => {
  const base = {
    uiGateEnabled: true,
    isInEnrichment: true,
    hasPreview: true,
    saveState: "saved" as const,
    serverReady: true,
    serverIssue: null,
    globalStatus: "SIN_PRUEBA_REAL",
    hasPreparedSingleSelection: true,
    hasExplicitConfirmation: true,
    isExecuting: false,
  };
  assert.match(getFirstRealSozarUiReadiness({ ...base, hasPreparedSingleSelection: false }).reason ?? "", /exactamente un móvil/i);
  assert.match(getFirstRealSozarUiReadiness({ ...base, globalStatus: "INCIERTA" }).reason ?? "", /INCIERTA/);
  assert.match(getFirstRealSozarUiReadiness({ ...base, serverIssue: "El móvil seleccionado ya tiene enriquecimiento API_REAL." }).reason ?? "", /API_REAL/);
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
  assert.deepEqual(planFirstRealSozarTest({ ...input, attemptLimitReached: true }), { status: "BLOQUEADO", reason: "LIMITE_GLOBAL" });
  assert.deepEqual(planFirstRealSozarTest({ ...input, hasReusableRealResult: true }), { status: "BLOQUEADO", reason: "RESULTADO_REUTILIZABLE" });
  for (const existingConsultationState of ["PENDIENTE", "EN_CURSO", "EXITOSA", "INCIERTA", "FALLIDA"] as const) {
    assert.deepEqual(planFirstRealSozarTest({ ...input, existingConsultationState }), { status: "BLOQUEADO", reason: "COLA_EXISTENTE" });
  }
});

test("la vía excepcional queda limitada al ejecutor de prueba y la vía masiva continúa cerrada", async () => {
  const client = await readFile(new URL("../lib/server/sozar-http-client.ts", import.meta.url), "utf8");
  const executor = await readFile(new URL("../lib/server/sozar-first-real-executor.ts", import.meta.url), "utf8");
  const resolverRoute = await readFile(new URL("../app/api/sozar/first-real/[attemptId]/resolver/route.ts", import.meta.url), "utf8");
  const workspace = await readFile(new URL("../components/excel-workspace.tsx", import.meta.url), "utf8");
  assert.match(client, /firstRealTestTransportBrand/);
  assert.match(client, /executionScope === "first-real-test"/);
  assert.match(executor, /"first-real-test"/);
  assert.match(executor, /estado: input\.failure\.state, tokenReserva: null, reservadaEn: null, reservaExpiraEn: null/);
  assert.match(executor, /automaticRetries: false/);
  assert.match(executor, /pg_advisory_xact_lock/);
  assert.match(resolverRoute, /requireAdminApi/);
  assert.match(resolverRoute, /resolveFirstRealSozarAttempt/);
  assert.match(workspace, /const firstRealSozarTestUiEnabled = true/);
  assert.match(workspace, /getFirstRealSozarUiReadiness/);
  assert.match(workspace, /Quedó bloqueada como INCIERTA y no se repetirá automáticamente/);
  assert.equal(SOZAR_EXECUTION_CODE_GATE, false);
  assert.equal(isSozarHlrExecutionEnabled, false);
});

test("la selección excepcional exige una ORIGINAL completa y no reutiliza API_REAL", async () => {
  const executor = await readFile(new URL("../lib/server/sozar-first-real-executor.ts", import.meta.url), "utf8");
  const selection = await readFile(new URL("../lib/server/sozar-first-real-selection.ts", import.meta.url), "utf8");
  assert.match(executor, /getFirstRealSozarEligibleRecord/);
  assert.match(selection, /base\.tipo !== "ORIGINAL"/);
  assert.match(selection, /recordProvenance === "API_REAL"/);
  assert.match(selection, /asociaciones: \{ some: \{ baseOriginalId: baseId \} \}/);
});
