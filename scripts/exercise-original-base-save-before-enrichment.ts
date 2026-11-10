import { randomUUID } from "node:crypto";
import nextEnv from "@next/env";
import { PrismaNeon } from "@prisma/adapter-neon";
import { Prisma, PrismaClient } from "../generated/prisma/client.ts";
import type { SaveStartPayload, StoredRecord } from "../lib/persistence/workspace-persistence.ts";

nextEnv.loadEnvConfig(process.cwd());

const testUrl = process.env.PRISMA_MIGRATION_TEST_URL;
const expectedBranchId = process.env.PRISMA_MIGRATION_TEST_BRANCH_ID;
if (!testUrl || !expectedBranchId) throw new Error("Dedicated Test configuration is required.");
process.env.DATABASE_URL = testUrl;
process.env.DATABASE_URL_UNPOOLED = testUrl;

const { beginBaseSave, completeBaseSave, saveRecordChunk } = await import("../lib/server/base-storage.ts");
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: testUrl }) });
const testRunId = randomUUID();
const userId = randomUUID();
const baseId = randomUUID();
const revision = randomUUID();
const rowCount = Number.parseInt(process.env.BASE_SAVE_BENCHMARK_ROWS ?? "9999", 10);
if (!Number.isInteger(rowCount) || rowCount < 2 || rowCount > 50_000) throw new Error("BASE_SAVE_BENCHMARK_ROWS must be between 2 and 50000.");
const firstPassRows = Math.max(1, Math.min(7_000, Math.floor(rowCount * 0.7)));
const seed = Number.parseInt(testRunId.replaceAll("-", "").slice(0, 6), 16) % 8_000_000;

function mobile(index: number): string {
  return `6${String(10_000_000 + seed + index).padStart(8, "0")}`;
}

function record(index: number): StoredRecord {
  const value = mobile(index);
  return {
    sourceRow: index + 2,
    cells: [value],
    mobile: value,
    document: "",
    name: "",
    contactPhone: "",
    normalizedMobile: value,
    reason: null,
    tipification: "VALIDO",
    enrichedCells: null,
    provenance: "EXCEL",
  };
}

const records = Array.from({ length: rowCount }, (_, index) => record(index));
const payload: SaveStartPayload = {
  id: baseId,
  name: "Synthetic ORIGINAL before enrichment",
  revision,
  expectedRecords: rowCount,
  validRecords: rowCount,
  excludedRecords: 0,
  state: "LISTA_PARA_ENRIQUECER",
  receivedAt: null,
  originalBaseId: null,
  metadata: {
    version: 1,
    completed: false,
    revision: null,
    originalFileName: `synthetic-original-before-enrichment-${testRunId}.xlsx`,
    columns: ["Teléfono Movil"],
    columnMapping: { movil: 0, enriched: {} },
    enrichmentColumns: null,
    enrichmentMode: "preserve",
    campaignFilters: {},
    distribution: { batchSize: 100, selectedCampaigns: [] },
    enrichmentSource: null,
    kind: "ORIGINAL",
    testRunId,
  },
};

async function persistThroughProductionPath(items: StoredRecord[]) {
  const startedAt = performance.now();
  let requests = 0;
  for (let index = 0; index < items.length; index += 400) {
    const chunks = Array.from({ length: Math.ceil(Math.min(400, items.length - index) / 100) }, (_, offset) => items.slice(index + offset * 100, index + (offset + 1) * 100));
    await Promise.all(chunks.map((chunk) => saveRecordChunk(baseId, revision, chunk)));
    requests += chunks.length;
  }
  return { requests, elapsedMs: Math.round(performance.now() - startedAt) };
}

try {
  console.log(JSON.stringify({ target: "test", testRunId, phase: "starting" }));
  const identity = await prisma.$queryRaw<{ branch_id: string | null }[]>(Prisma.sql`SELECT current_setting('neon.branch_id', true) AS branch_id`);
  if (identity[0]?.branch_id !== expectedBranchId) throw new Error("Test branch identity mismatch.");
  console.log(JSON.stringify({ target: "test", phase: "branch-verified", expectedBranchId }));
  await prisma.usuario.create({ data: { id: userId, username: `synthetic-original-save-${testRunId}`, passwordHash: "synthetic-not-a-login-hash", activo: false } });
  console.log(JSON.stringify({ target: "test", phase: "fixture-user-created" }));
  await beginBaseSave(payload);
  console.log(JSON.stringify({ target: "test", phase: "base-started" }));
  // Simulate an interrupted browser upload with an exact, isolated partial
  // snapshot. No incomplete fixture may be treated as operational.
  const firstPass = await persistThroughProductionPath(records.slice(0, firstPassRows));
  console.log(JSON.stringify({ target: "test", phase: "interruption-created", rowsPersisted: firstPassRows, ...firstPass }));

  let incompleteRejected = false;
  try {
    await completeBaseSave(baseId, revision, [], userId);
  } catch (error) {
    incompleteRejected = error instanceof Error && /carga de registros aún no está completa/.test(error.message);
  }
  const partial = await prisma.base.findUniqueOrThrow({ where: { id: baseId }, select: { metadatos: true } });
  if (!incompleteRejected || (partial.metadatos as { completed?: boolean }).completed) {
    throw new Error("An interrupted ORIGINAL save was incorrectly completed.");
  }

  const secondPass = await persistThroughProductionPath(records.slice(firstPassRows));
  console.log(JSON.stringify({ target: "test", phase: "all-rows-persisted", rowsPersisted: rowCount, ...secondPass }));
  const completed = await completeBaseSave(baseId, revision, [], userId);
  const repeatedCompletion = await completeBaseSave(baseId, revision, [], userId);
  const [base, persisted, lots, reservations] = await Promise.all([
    prisma.base.findUniqueOrThrow({ where: { id: baseId }, select: { metadatos: true, cantidadImportados: true, estado: true } }),
    prisma.registro.count({ where: { baseId } }),
    prisma.lote.count({ where: { baseId } }),
    prisma.reservaComercial.count({ where: { baseId } }),
  ]);
  const completedMetadata = base.metadatos as { completed?: boolean; revision?: string | null; commercialDistributionConfirmed?: boolean };
  if (!completed || !repeatedCompletion || persisted !== rowCount || base.cantidadImportados !== rowCount || base.estado !== "LISTA_PARA_ENRIQUECER" || !completedMetadata.completed || completedMetadata.revision !== null || completedMetadata.commercialDistributionConfirmed || lots !== 0 || reservations !== 0) {
    throw new Error("The completed ORIGINAL did not retain the required pre-enrichment state.");
  }
  console.log(JSON.stringify({ target: "test", testRunId, expectedBranchId, interruptedAt: firstPassRows, interruptedSaveRejected: true, rowsPersisted: persisted, requests: firstPass.requests + secondPass.requests, elapsedMs: firstPass.elapsedMs + secondPass.elapsedMs, rowsPerSecond: Math.round(rowCount / ((firstPass.elapsedMs + secondPass.elapsedMs) / 1_000)), completedBeforeEnrichment: true, idempotentCompletion: true, lots, reservations, providerCalls: 0 }));
} catch (error) {
  console.error(JSON.stringify({ target: "test", phase: "failed", error: error instanceof Error ? error.message : "unknown" }));
  throw error;
} finally {
  const auditIds = (await prisma.eventoAuditoria.findMany({ where: { baseId, usuarioId: userId }, select: { id: true } })).map((event) => event.id);
  if (auditIds.length) await prisma.eventoAuditoria.deleteMany({ where: { id: { in: auditIds } } });
  await prisma.base.deleteMany({ where: { id: baseId } });
  await prisma.usuario.deleteMany({ where: { id: userId } });
  const [bases, users] = await Promise.all([
    prisma.base.count({ where: { id: baseId } }),
    prisma.usuario.count({ where: { id: userId } }),
  ]);
  if (bases || users) throw new Error("Synthetic pre-enrichment fixture cleanup was incomplete.");
  await prisma.$disconnect();
}
