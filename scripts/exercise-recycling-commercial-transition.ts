import { randomUUID } from "node:crypto";
import nextEnv from "@next/env";
import { Prisma, PrismaClient } from "../generated/prisma/client.ts";
import { PrismaNeon } from "@prisma/adapter-neon";

nextEnv.loadEnvConfig(process.cwd());
const testUrl = process.env.PRISMA_MIGRATION_TEST_URL;
const expectedBranchId = process.env.PRISMA_MIGRATION_TEST_BRANCH_ID;
if (!testUrl || !expectedBranchId) throw new Error("Dedicated Test configuration is required.");
process.env.DATABASE_URL = testUrl;
process.env.DATABASE_URL_UNPOOLED = testUrl;

const { beginBaseSave, completeBaseSave, saveRecordChunk } = await import("../lib/server/base-storage.ts");
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: testUrl }) });
const testRunId = randomUUID();
const ids = { user: randomUUID(), original: randomUUID(), recycled: randomUUID(), rejected: randomUUID(), execution: randomUUID(), rejectedExecution: randomUUID() };
const mobiles = Array.from({ length: 250 }, (_, index) => `63${String(30_000_000 + index).slice(-7)}`);
const sourceRows = mobiles.map((_, index) => index + 2);
const initialRevision = randomUUID();
const transitionRevision = randomUUID();
const rejectedRevision = randomUUID();

function baseMetadata(revision: string | null, extra: Record<string, unknown> = {}) {
  return {
    version: 1, completed: false, revision, originalFileName: `synthetic-transition-${testRunId}.xlsx`,
    columns: ["Teléfono Movil", "Nombre"], columnMapping: { movil: 0, nombre: 1, enriched: {} },
    enrichmentColumns: ["Teléfono Movil", "Operador Actual", "Operador Original", "Fecha Portabilidad"], enrichmentMode: "preserve",
    campaignFilters: {}, distribution: { batchSize: 100, selectedCampaigns: ["yoigo"] }, enrichmentSource: "api_real", testRunId,
    ...extra,
  };
}

function lots(rows: readonly number[]) {
  return Array.from({ length: Math.ceil(rows.length / 100) }, (_, index) => ({ campaign: "YOIGO" as const, number: index + 1, sourceRows: rows.slice(index * 100, (index + 1) * 100) }));
}

function record(mobile: string, index: number, priorReservationIds: readonly string[] = []) {
  const cells = [mobile, `Synthetic ${index}`];
  const enrichedCells = [mobile, "Vodafone", "Vodafone", "2026-01-01"];
  return {
    numeroFilaOriginal: index + 2, movilNormalizado: mobile, documento: `SYN-${index}`, nombre: `Synthetic ${index}`,
    operadorActual: "Vodafone", operadorOriginal: "Vodafone", fechaPortabilidad: new Date("2026-01-01T00:00:00.000Z"), tipificacion: "VALIDO" as const,
    datosOriginales: { version: 1, cells, mobile, contactPhone: "", reason: null, enrichedCells, provenance: "API_REAL", testRunId, globalTransition: { executionId: ids.execution, priorReservationIds } },
  };
}

function storedRecord(mobile: string, index: number) {
  return {
    sourceRow: index + 2, cells: [mobile, `Synthetic ${index}`], mobile, document: `SYN-${index}`, name: `Synthetic ${index}`,
    contactPhone: "", normalizedMobile: mobile, reason: null, tipification: "VALIDO" as const,
    enrichedCells: [mobile, "Vodafone", "Vodafone", "2026-01-01"], provenance: "API_REAL" as const,
  };
}

async function createBase(input: { id: string; code: string; kind: "ORIGINAL" | "RECICLADA"; originalId?: string; revision: string; globalExecutionId?: string; transitionCount?: number; records: ReturnType<typeof record>[] }) {
  await prisma.base.create({ data: {
    id: input.id, codigo: input.code, nombreOriginal: `synthetic-transition-${testRunId}.xlsx`, nombreDescriptivo: "Fase 3 transition fixture",
    tipo: input.kind, baseOriginalId: input.originalId, estado: "LISTA_PARA_DISTRIBUIR", cantidadImportados: input.records.length,
    cantidadValidos: input.records.length, cantidadExcluidos: 0,
    metadatos: baseMetadata(input.revision, input.globalExecutionId ? { kind: "RECICLADA", globalRecyclingExecutionId: input.globalExecutionId, globalTransitionReservationCount: input.transitionCount ?? 0 } : {}),
    registros: { create: input.records },
  } });
}

try {
  console.log(JSON.stringify({ target: "test", testRunId, phase: "starting" }));
  const identity = await prisma.$queryRaw<{ branch_id: string | null }[]>(Prisma.sql`SELECT current_setting('neon.branch_id', true) AS branch_id`);
  if (identity[0]?.branch_id !== expectedBranchId) throw new Error("Test branch identity mismatch.");
  await prisma.usuario.create({ data: { id: ids.user, username: `synthetic-transition-${testRunId}`, passwordHash: "synthetic-not-a-login-hash", activo: true } });

  await createBase({ id: ids.original, code: `TRN-${testRunId.slice(0, 8)}-O`, kind: "ORIGINAL", revision: initialRevision, records: mobiles.map(record) });
  const initial = await completeBaseSave(ids.original, initialRevision, lots(sourceRows), ids.user);
  if (!initial || initial.createdLots !== 3) throw new Error("Initial 250-record distribution did not persist three lots.");
  console.log(JSON.stringify({ target: "test", testRunId, phase: "initial-distribution-confirmed" }));
  const oldReservations = await prisma.reservaComercial.findMany({ where: { baseId: ids.original, estado: "ACTIVA" }, select: { id: true, movilNormalizado: true } });
  if (oldReservations.length !== 250) throw new Error("Initial reservations are incomplete.");
  const priorIds = new Map(oldReservations.map((reservation) => [reservation.movilNormalizado, reservation.id]));

  await createBase({ id: ids.recycled, code: `TRN-${testRunId.slice(0, 8)}-R`, kind: "RECICLADA", originalId: ids.original, revision: transitionRevision, globalExecutionId: ids.execution, transitionCount: 250, records: mobiles.map((mobile, index) => record(mobile, index, [priorIds.get(mobile)!])) });
  await prisma.ejecucionReciclajeGlobal.create({ data: {
    id: ids.execution, operacionId: `transition-${testRunId}`, usuarioId: ids.user, fechaEfectiva: new Date("2026-11-08T00:00:00.000Z"), estado: "EVALUADA", versionReglas: "synthetic", criterios: { testRunId }, baseRecicladaId: ids.recycled,
    decisiones: { create: mobiles.map((mobile) => ({ movilNormalizado: mobile, decision: "ELEGIBLE", motivo: "Synthetic eligible", fuentes: { version: 2, records: [], activeReservationIds: [priorIds.get(mobile)!] } })) },
  } });
  const beforeReopen = await prisma.registro.findFirstOrThrow({ where: { baseId: ids.recycled, movilNormalizado: mobiles[0] }, select: { datosOriginales: true } });
  const beforeIds = (beforeReopen.datosOriginales as { globalTransition?: { priorReservationIds?: unknown } }).globalTransition?.priorReservationIds;
  if (!Array.isArray(beforeIds) || beforeIds[0] !== priorIds.get(mobiles[0]!)) throw new Error("Fixture did not persist its snapshotted reservation evidence.");

  // A global base is normally generated completed. Reopen it through the
  // standard client-save path before commercial confirmation: its prior hold
  // identifiers must survive without trusting a browser-supplied field.
  await prisma.base.update({ where: { id: ids.recycled }, data: { metadatos: baseMetadata(null, { completed: true, kind: "RECICLADA", globalRecyclingExecutionId: ids.execution, globalTransitionReservationCount: 250 }) } });
  await beginBaseSave({
    id: ids.recycled, name: "Fase 3 transition fixture", revision: transitionRevision, expectedRecords: 250, validRecords: 250, excludedRecords: 0,
    state: "LISTA_PARA_DISTRIBUIR", receivedAt: null, originalBaseId: ids.original,
    metadata: baseMetadata(null, { kind: "RECICLADA", globalRecyclingExecutionId: ids.execution, globalTransitionReservationCount: 250 }) as never,
  });
  // One representative client chunk is enough to prove that reopening never
  // erases server-only transition evidence; the 250-record distribution below
  // still validates the complete atomic replacement.
  await saveRecordChunk(ids.recycled, transitionRevision, [storedRecord(mobiles[0]!, 0)]);
  const preserved = await prisma.registro.findFirstOrThrow({ where: { baseId: ids.recycled, movilNormalizado: mobiles[0] }, select: { datosOriginales: true } });
  const preservedIds = (preserved.datosOriginales as { globalTransition?: { priorReservationIds?: unknown } }).globalTransition?.priorReservationIds;
  if (!Array.isArray(preservedIds) || preservedIds[0] !== priorIds.get(mobiles[0]!)) throw new Error(`Reopened global base lost its snapshotted reservation evidence (before=${Array.isArray(beforeIds) ? beforeIds.length : 0}, after=${Array.isArray(preservedIds) ? preservedIds.length : 0}).`);

  const concurrent = await Promise.allSettled([
    completeBaseSave(ids.recycled, transitionRevision, lots(sourceRows), ids.user),
    completeBaseSave(ids.recycled, transitionRevision, lots(sourceRows), ids.user),
  ]);
  console.log(JSON.stringify({ target: "test", testRunId, phase: "concurrent-transition-settled" }));
  const completed = concurrent.filter((result): result is PromiseFulfilledResult<Exclude<Awaited<ReturnType<typeof completeBaseSave>>, false>> => result.status === "fulfilled" && result.value !== false);
  if (completed.length !== 1 || completed[0]!.value.releasedPriorReservations !== 250 || completed[0]!.value.createdLots !== 3) throw new Error("Concurrent transition did not produce exactly one atomic replacement.");
  const [oldActive, oldReleased, newActive, newLots, auditCount] = await Promise.all([
    prisma.reservaComercial.count({ where: { baseId: ids.original, estado: "ACTIVA" } }),
    prisma.reservaComercial.count({ where: { baseId: ids.original, estado: "LIBERADA" } }),
    prisma.reservaComercial.count({ where: { baseId: ids.recycled, estado: "ACTIVA" } }),
    prisma.lote.count({ where: { baseId: ids.recycled } }),
    prisma.eventoAuditoria.count({ where: { baseId: ids.original, accion: "RESERVA_LIBERADA", metadatos: { path: ["reason"], equals: "TRANSICION_RECICLAJE_AUTORIZADA" } } }),
  ]);
  if (oldActive !== 0 || oldReleased !== 250 || newActive !== 250 || newLots !== 3 || auditCount !== 250) throw new Error("Transition lost reservation history or created duplicate active assignments.");
  if (await completeBaseSave(ids.recycled, transitionRevision, lots(sourceRows), ids.user) !== false) throw new Error("Retry changed an already confirmed transition.");

  await createBase({ id: ids.rejected, code: `TRN-${testRunId.slice(0, 8)}-X`, kind: "RECICLADA", originalId: ids.original, revision: rejectedRevision, globalExecutionId: ids.rejectedExecution, records: [record(mobiles[0]!, 0)] });
  await prisma.ejecucionReciclajeGlobal.create({ data: { id: ids.rejectedExecution, operacionId: `transition-rejected-${testRunId}`, usuarioId: ids.user, fechaEfectiva: new Date("2026-11-08T00:00:00.000Z"), estado: "EVALUADA", versionReglas: "synthetic", criterios: { testRunId }, baseRecicladaId: ids.rejected, decisiones: { create: { movilNormalizado: mobiles[0]!, decision: "ELEGIBLE", motivo: "Synthetic eligible", fuentes: { version: 2, records: [], activeReservationIds: [] } } } } });
  let snapshotRejected = false;
  try { await completeBaseSave(ids.rejected, rejectedRevision, lots([2]), ids.user); } catch { snapshotRejected = true; }
  if (!snapshotRejected || await prisma.lote.count({ where: { baseId: ids.rejected } }) !== 0 || await prisma.reservaComercial.count({ where: { baseId: ids.rejected } }) !== 0) throw new Error("A changed active reservation left a partial transition.");

  console.log(JSON.stringify({ target: "test", testRunId, initialLots: 3, transitionedReservations: 250, replacementLots: 3, concurrentSingleTransition: true, retryNoDuplicate: true, changedSnapshotRejected: true, fixturesCleaned: true }));
} finally {
  const baseIds = [ids.original, ids.recycled, ids.rejected];
  await prisma.eventoAuditoria.deleteMany({ where: { baseId: { in: baseIds } } });
  await prisma.reservaComercial.deleteMany({ where: { baseId: { in: baseIds } } });
  await prisma.decisionEjecucionReciclajeGlobal.deleteMany({ where: { ejecucionId: { in: [ids.execution, ids.rejectedExecution] } } });
  await prisma.ejecucionReciclajeGlobal.deleteMany({ where: { id: { in: [ids.execution, ids.rejectedExecution] } } });
  await prisma.base.deleteMany({ where: { id: { in: baseIds } } });
  await prisma.usuario.deleteMany({ where: { id: ids.user } });
  const [bases, reservations, executions, user] = await Promise.all([
    prisma.base.count({ where: { id: { in: baseIds } } }),
    prisma.reservaComercial.count({ where: { baseId: { in: baseIds } } }),
    prisma.ejecucionReciclajeGlobal.count({ where: { id: { in: [ids.execution, ids.rejectedExecution] } } }),
    prisma.usuario.count({ where: { id: ids.user } }),
  ]);
  if (bases || reservations || executions || user) throw new Error("Transition fixture cleanup was incomplete.");
  await prisma.$disconnect();
}
