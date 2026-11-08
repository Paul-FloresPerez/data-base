import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import nextEnv from "@next/env";
import { Client } from "pg";
import { PrismaClient } from "../generated/prisma/client.ts";
import { PrismaNeon } from "@prisma/adapter-neon";

nextEnv.loadEnvConfig(process.cwd());
const url = process.env.PRISMA_MIGRATION_TEST_URL;
const expectedBranch = process.env.PRISMA_MIGRATION_TEST_BRANCH_ID;
if (!url || !expectedBranch) throw new Error("La conexión segura de Test no está configurada.");

const identity = new Client({ connectionString: url });
await identity.connect();
try {
  const result = await identity.query<{ branch_id: string | null }>("SELECT current_setting('neon.branch_id', true) AS branch_id");
  if (result.rows[0]?.branch_id !== expectedBranch) throw new Error("La identidad de Neon Test no coincide.");
} finally {
  await identity.end();
}

process.env.DATABASE_URL = url;
process.env.SOZAR_MOBILE_FINGERPRINT_KEY = Buffer.alloc(32, 7).toString("base64url");
process.env.SOZAR_RESPONSE_ENCRYPTION_KEY = Buffer.alloc(32, 8).toString("base64url");
process.env.SOZAR_FIRST_REAL_MAX_ATTEMPTS = "100";
process.env.SOZAR_FIRST_REAL_BUDGET_CENTS = "1000";
process.env.SOZAR_FIRST_REAL_MAX_COST_CENTS = "100";

const { prisma } = await import("../lib/server/prisma.ts");
const { executeFirstRealSozarTest, resolveFirstRealSozarAttempt } = await import("../lib/server/sozar-first-real-executor.ts");
const run = randomUUID();
const ids = { user: randomUUID(), secondUser: randomUUID(), base: randomUUID() };
const mobilePrefix = `6${String(Number.parseInt(run.replaceAll("-", "").slice(0, 8), 16) % 10_000_000).padStart(7, "0")}`;
const variant = process.env.SOZAR_LIFECYCLE_VARIANT ?? "core";
const suffixesByVariant: Record<string, number[]> = {
  core: [1, 2, 3, 0],
  http: [1, 5, 6, 7, 8],
  json: [1, 9, 3, 0],
};
const suffixes = suffixesByVariant[variant];
if (!suffixes) throw new Error("SOZAR_LIFECYCLE_VARIANT debe ser core, http o json.");
const mobiles = suffixes.map((suffix) => `${mobilePrefix}${suffix}`);
const fetchBefore = globalThis.fetch;
const endpointBefore = process.env.SOZAR_ENDPOINT_TEMPLATE;
const cleanup = new PrismaClient({ adapter: new PrismaNeon({ connectionString: url }) });
let completedSummary: Record<string, unknown> | null = null;
const auxiliaryConsultationIds: string[] = [];

function outcomeFor(mobile: string) {
  const suffix = mobile.at(-1);
  if (suffix === "1") throw new Error("transport fixture");
  if (suffix === "2") { const error = new Error("timeout fixture"); error.name = "AbortError"; throw error; }
  if (suffix === "4") return new Response("unauthorized", { status: 401 });
  if (suffix === "5") return new Response("forbidden", { status: 403 });
  if (suffix === "6") return new Response("missing", { status: 404 });
  if (suffix === "7") return new Response("limited", { status: 429 });
  if (suffix === "8") return new Response("failure", { status: 500 });
  if (suffix === "9") return new Response("not json", { status: 200, headers: { "content-type": "application/json" } });
  return new Response(JSON.stringify({ synthetic: true, status: "ok" }), { status: 200, headers: { "content-type": "application/json" } });
}

try {
  console.log(JSON.stringify({ target: "test", branchId: expectedBranch, testRunId: run, phase: "started" }));
  globalThis.fetch = (async (input: string | URL | Request) => outcomeFor(new URL(String(input)).pathname.split("/").at(-1)!) as Response) as typeof fetch;
  await prisma.usuario.createMany({ data: [
    { id: ids.user, username: `synthetic-sozar-a-${run}`, passwordHash: "synthetic", activo: true },
    { id: ids.secondUser, username: `synthetic-sozar-b-${run}`, passwordHash: "synthetic", activo: true },
  ] });
  await prisma.base.create({ data: { id: ids.base, codigo: `SOZ-${run.slice(0, 8)}`, nombreOriginal: "synthetic.xlsx", nombreDescriptivo: "Sozar lifecycle", tipo: "ORIGINAL", estado: "LISTA_PARA_DISTRIBUIR", cantidadImportados: mobiles.length, cantidadValidos: mobiles.length, cantidadExcluidos: 0, metadatos: { completed: true, synthetic: true, testRunId: run } } });
  await prisma.registro.createMany({ data: mobiles.map((mobile, index) => ({ baseId: ids.base, numeroFilaOriginal: index + 2, movilNormalizado: mobile, tipificacion: "VALIDO", datosOriginales: { provenance: "MOCK", synthetic: true, testRunId: run } })) });
  const stuck = await prisma.consultaHlr.create({ data: { proveedor: "sozar", huellaMovil: `synthetic-stuck-${run}`, claveIdempotencia: `synthetic-stuck-${run}`, estado: "EN_CURSO", tokenReserva: randomUUID(), reservadaEn: new Date(), reservaExpiraEn: new Date(Date.now() + 60_000), intentos: 1 } });
  auxiliaryConsultationIds.push(stuck.id);
  const markedUncertain = await resolveFirstRealSozarAttempt({ attemptId: stuck.id, userId: ids.user, operationId: randomUUID(), resolution: "MARCAR_INCIERTA", evidenceReference: "synthetic-no-provider-response" });
  assert.deepEqual(markedUncertain, { state: "INCIERTA", reused: false });

  const concurrent = await Promise.all([
    executeFirstRealSozarTest({ baseId: ids.base, sourceRow: 2, userId: ids.user }),
    executeFirstRealSozarTest({ baseId: ids.base, sourceRow: 2, userId: ids.secondUser }),
  ]);
  assert.equal(concurrent.filter((result) => result.status === "INCIERTA").length, 1);
  assert.equal(concurrent.filter((result) => result.status === "BLOQUEADO" && result.reason === "COLA_EXISTENTE").length, 1);
  const results = [...concurrent] as Awaited<ReturnType<typeof executeFirstRealSozarTest>>[];
  for (let index = 1; index < mobiles.length; index += 1) {
    if (variant === "core" && index === mobiles.length - 1) process.env.SOZAR_ENDPOINT_TEMPLATE = "http://invalid.example/{numero}";
    results.push(await executeFirstRealSozarTest({ baseId: ids.base, sourceRow: index + 2, userId: ids.user }));
  }
  if (endpointBefore === undefined) delete process.env.SOZAR_ENDPOINT_TEMPLATE;
  else process.env.SOZAR_ENDPOINT_TEMPLATE = endpointBefore;
  const consultations = await prisma.consultaHlr.findMany({ where: { proveedor: "sozar", destinos: { some: { baseId: ids.base } } }, include: { eventos: { orderBy: { creadoEn: "asc" } } } });
  const byState = new Map(consultations.map((consultation) => [consultation.id, consultation]));
  const uncertain = results.find((result) => result.status === "INCIERTA") as { attemptId?: string } | undefined;
  if (!uncertain || typeof uncertain.attemptId !== "string") throw new Error("Expected a synthetic uncertain attempt.");
  const uncertainId = uncertain.attemptId;
  const uncertainRow = byState.get(uncertainId);
  assert.equal(uncertainRow?.estado, "INCIERTA");
  assert.equal(uncertainRow?.tokenReserva, null);
  assert.equal(uncertainRow?.reservadaEn, null);
  assert.equal(uncertainRow?.reservaExpiraEn, null);
  if (suffixes.includes(3)) assert.ok(results.some((result) => result.status === "RESPUESTA_CIFRADA_PENDIENTE_DE_CONTRATO"));
  if (variant !== "json") assert.ok(results.some((result) => result.status === "FALLIDA"));

  const duplicate = await executeFirstRealSozarTest({ baseId: ids.base, sourceRow: 2, userId: ids.user });
  assert.deepEqual(duplicate, { status: "BLOQUEADO", reason: "COLA_EXISTENTE" });
  const review = await resolveFirstRealSozarAttempt({ attemptId: uncertainId, userId: ids.user, operationId: randomUUID(), resolution: "MANTIENE_INCIERTA", evidenceReference: "synthetic-provider-record" });
  assert.deepEqual(review, { state: "INCIERTA", reused: false });
  const close = await resolveFirstRealSozarAttempt({ attemptId: uncertainId, userId: ids.user, operationId: randomUUID(), resolution: "NO_ENVIADA_CONFIRMADA", evidenceReference: "synthetic-provider-no-send" });
  assert.deepEqual(close, { state: "FALLIDA", reused: false });
  console.log(JSON.stringify({ testRunId: run, phase: "cleanup" }));
  completedSummary = { target: "test", branchId: expectedBranch, testRunId: run, variant, providerCalls: variant === "core" ? mobiles.length - 1 : mobiles.length, transport: "simulated", uncertain: true, httpFailures: suffixes.filter((suffix) => suffix >= 4 && suffix <= 8).map((suffix) => ({ 4: 401, 5: 403, 6: 404, 7: 429, 8: 500 })[suffix]), jsonInvalid: suffixes.includes(9), duplicateBlocked: true, twoAdministratorsSerialized: true, administrativeResolution: true, fixturesCleaned: true };
} finally {
  globalThis.fetch = fetchBefore;
  if (endpointBefore === undefined) delete process.env.SOZAR_ENDPOINT_TEMPLATE;
  else process.env.SOZAR_ENDPOINT_TEMPLATE = endpointBefore;
  const approvals = await cleanup.aprobacionHlr.findMany({ where: { baseId: ids.base }, select: { id: true } });
  const consultations = await cleanup.consultaHlr.findMany({ where: { destinos: { some: { baseId: ids.base } } }, select: { id: true, resultadoId: true } });
  const consultationIds = [...consultations.map((consultation) => consultation.id), ...auxiliaryConsultationIds];
  if (consultationIds.length) await cleanup.eventoConsultaHlr.deleteMany({ where: { consultaId: { in: consultationIds } } });
  if (consultationIds.length) await cleanup.consultaHlr.deleteMany({ where: { id: { in: consultationIds } } });
  const resultIds = consultations.flatMap((consultation) => consultation.resultadoId ? [consultation.resultadoId] : []);
  if (resultIds.length) await cleanup.resultadoHlrReal.deleteMany({ where: { id: { in: resultIds } } });
  if (approvals.length) await cleanup.aprobacionHlr.deleteMany({ where: { id: { in: approvals.map((approval) => approval.id) } } });
  await cleanup.base.deleteMany({ where: { id: ids.base } });
  await cleanup.usuario.deleteMany({ where: { id: { in: [ids.user, ids.secondUser] } } });
  await cleanup.$disconnect();
  await prisma.$disconnect().catch(() => undefined);
  if (completedSummary) console.log(JSON.stringify(completedSummary));
}
