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

const { beginBaseSave, completeBaseSave } = await import("../lib/server/base-storage.ts");
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: testUrl }) });
const testRunId = randomUUID();
const userId = randomUUID();
const baseId = randomUUID();
const revision = randomUUID();
const rowCount = 9_999;
const firstPassRows = 7_000;
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

function persistedRecord(record: StoredRecord) {
  return {
    baseId,
    numeroFilaOriginal: record.sourceRow,
    movilNormalizado: record.normalizedMobile,
    documento: record.document || null,
    nombre: record.name || null,
    tipificacion: record.tipification,
    datosOriginales: {
      version: 1,
      cells: record.cells,
      mobile: record.mobile,
      contactPhone: record.contactPhone,
      reason: record.reason,
      enrichedCells: record.enrichedCells,
      provenance: record.provenance,
    },
  };
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
  await prisma.registro.createMany({ data: records.slice(0, firstPassRows).map(persistedRecord) });
  console.log(JSON.stringify({ target: "test", phase: "interruption-created", rowsPersisted: firstPassRows }));

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

  // The client-side protocol is unit-tested at 100 chunks. This integration
  // test validates the server's 9,999-row completion and recovery invariants
  // using direct Test-only fixture insertion, avoiding 100 remote round trips.
  await prisma.registro.createMany({ data: records.slice(firstPassRows).map(persistedRecord) });
  console.log(JSON.stringify({ target: "test", phase: "all-rows-persisted", rowsPersisted: rowCount }));
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
  console.log(JSON.stringify({ target: "test", testRunId, expectedBranchId, interruptedAt: firstPassRows, interruptedSaveRejected: true, rowsPersisted: persisted, completedBeforeEnrichment: true, idempotentCompletion: true, lots, reservations, providerCalls: 0 }));
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
