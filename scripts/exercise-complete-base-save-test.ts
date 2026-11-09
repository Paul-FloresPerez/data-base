import { randomUUID } from "node:crypto";
import nextEnv from "@next/env";
import { PrismaNeon } from "@prisma/adapter-neon";
import { Prisma, PrismaClient } from "../generated/prisma/client.ts";

nextEnv.loadEnvConfig(process.cwd());
const testUrl = process.env.PRISMA_MIGRATION_TEST_URL;
const expectedBranchId = process.env.PRISMA_MIGRATION_TEST_BRANCH_ID;
if (!testUrl || !expectedBranchId) throw new Error("Dedicated Test configuration is required.");
process.env.DATABASE_URL = testUrl;
process.env.DATABASE_URL_UNPOOLED = testUrl;

const { completeBaseSave } = await import("../lib/server/base-storage.ts");
const { importExternalSales } = await import("../lib/server/sales-storage.ts");
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: testUrl }) });
const testRunId = randomUUID();
const userId = randomUUID();
const blockedBaseId = randomUUID();
const controlBaseId = randomUUID();
const saleImportId = randomUUID();
const concurrentBaseId = randomUUID();
const concurrentImportId = randomUUID();
const independentBaseAId = randomUUID();
const independentBaseBId = randomUUID();
const mobileBlocked = "612345678";
const mobileControl = "712345678";
const mobileConcurrent = "622345678";
const mobileIndependentA = "632345678";
const mobileIndependentB = "722345678";

function metadata(revision: string) {
  return { version: 1, completed: false, revision, originalFileName: `synthetic-${testRunId}.xlsx`, columns: ["Teléfono Movil"], columnMapping: { movil: 0, enriched: {} }, enrichmentColumns: ["Operador Actual"], enrichmentMode: "preserve", campaignFilters: {}, distribution: { batchSize: 100, selectedCampaigns: ["yoigo"] }, enrichmentSource: "api_real", testRunId };
}
async function createBase(id: string, mobile: string, revision: string) {
  await prisma.base.create({ data: { id, codigo: `P001-${id.slice(0, 8)}`, nombreOriginal: `synthetic-${testRunId}.xlsx`, nombreDescriptivo: "P0-01 integration fixture", estado: "LISTA_PARA_DISTRIBUIR", cantidadImportados: 1, cantidadValidos: 1, cantidadExcluidos: 0, metadatos: metadata(revision), registros: { create: { numeroFilaOriginal: 2, movilNormalizado: mobile, operadorActual: "Vodafone", tipificacion: "VALIDO", datosOriginales: { version: 1, cells: [mobile], mobile, contactPhone: "", reason: null, enrichedCells: ["Vodafone"], provenance: "EXCEL", testRunId } } } } });
}

function fingerprint(seed: string) {
  return seed.replaceAll("-", "").padEnd(64, "0").slice(0, 64);
}

function confirmedSaleInput(importId: string, mobile: string, suffix: string) {
  return {
    importId,
    userId,
    fileName: `synthetic-${testRunId}-${suffix}.xlsx`,
    declaredPeriod: null,
    sourceFingerprint: fingerprint(`${testRunId}${suffix}`),
    events: [{ sourceRow: 2, mobile, saleStatus: "CONFIRMADA" as const, originalStatus: "CONFIRMADA", reason: "VALIDA" as const, soldAt: null, advisor: null, campaign: "YOIGO" }],
  };
}

try {
  const identity = await prisma.$queryRaw<{ branch_id: string | null }[]>(Prisma.sql`SELECT current_setting('neon.branch_id', true) AS branch_id`);
  if (identity[0]?.branch_id !== expectedBranchId) throw new Error("Test branch identity mismatch.");
  await prisma.usuario.create({ data: { id: userId, username: `complete-save-${testRunId}`, passwordHash: "synthetic-not-a-login-hash", activo: false } });
  const blockedRevision = randomUUID();
  await createBase(blockedBaseId, mobileBlocked, blockedRevision);
  await importExternalSales(confirmedSaleInput(saleImportId, mobileBlocked, "before-lot"));
  let blocked = false;
  try { await completeBaseSave(blockedBaseId, blockedRevision, [{ campaign: "YOIGO", number: 1, sourceRows: [2] }], userId); } catch { blocked = true; }
  const blockedLots = await prisma.lote.count({ where: { baseId: blockedBaseId } });
  const blockedBase = await prisma.base.findUnique({ where: { id: blockedBaseId }, select: { metadatos: true } });
  if (!blocked || blockedLots !== 0 || (blockedBase?.metadatos as { completed?: boolean }).completed) throw new Error("Confirmed sale did not atomically reject completeBaseSave.");
  const controlRevision = randomUUID();
  await createBase(controlBaseId, mobileControl, controlRevision);
  const persisted = await completeBaseSave(controlBaseId, controlRevision, [{ campaign: "YOIGO", number: 1, sourceRows: [2] }], userId);
  const controlLots = await prisma.lote.count({ where: { baseId: controlBaseId } });
  if (!persisted || controlLots !== 1) throw new Error("Control completeBaseSave did not persist the lot.");
  // Both services run concurrently here. Whichever acquires the transaction
  // advisory lock first determines the historical order: a sale first rejects
  // the lot, while a lot first persists and the later sale remains historical.
  const concurrentRevision = randomUUID();
  await createBase(concurrentBaseId, mobileConcurrent, concurrentRevision);
  const [lotResult, saleResult] = await Promise.allSettled([
    completeBaseSave(concurrentBaseId, concurrentRevision, [{ campaign: "YOIGO", number: 1, sourceRows: [2] }], userId),
    importExternalSales(confirmedSaleInput(concurrentImportId, mobileConcurrent, "concurrent")),
  ]);
  if (saleResult.status !== "fulfilled") throw saleResult.reason;
  const concurrentLots = await prisma.lote.count({ where: { baseId: concurrentBaseId } });
  const concurrentBase = await prisma.base.findUnique({ where: { id: concurrentBaseId }, select: { metadatos: true } });
  const concurrentCompleted = Boolean((concurrentBase?.metadatos as { completed?: boolean } | null)?.completed);
  const lotWon = lotResult.status === "fulfilled";
  if ((lotWon && (concurrentLots !== 1 || !concurrentCompleted)) || (!lotWon && (concurrentLots !== 0 || concurrentCompleted))) {
    throw new Error("Concurrent sale and lot persistence reached an inconsistent state.");
  }
  const independentRevisionA = randomUUID();
  const independentRevisionB = randomUUID();
  await Promise.all([
    createBase(independentBaseAId, mobileIndependentA, independentRevisionA),
    createBase(independentBaseBId, mobileIndependentB, independentRevisionB),
  ]);
  const independentResults = await Promise.allSettled([
    completeBaseSave(independentBaseAId, independentRevisionA, [{ campaign: "YOIGO", number: 1, sourceRows: [2] }], userId),
    completeBaseSave(independentBaseBId, independentRevisionB, [{ campaign: "YOIGO", number: 1, sourceRows: [2] }], userId),
  ]);
  if (independentResults.some((result) => result.status !== "fulfilled")) throw new Error("Independent mobiles were unexpectedly blocked.");
  const independentLots = await prisma.lote.count({ where: { baseId: { in: [independentBaseAId, independentBaseBId] } } });
  if (independentLots !== 2) throw new Error("Independent mobile lots were not both persisted.");
  console.log(JSON.stringify({ target: "test", testRunId, completeBaseSaveInvoked: true, confirmedSaleRejected: true, controlPersisted: true, concurrentServices: true, concurrentOutcome: lotWon ? "LOT_FIRST" : "SALE_FIRST", independentMobilesPersisted: true, blockedLots, controlLots, concurrentLots, independentLots }));
} finally {
  const baseIds = [blockedBaseId, controlBaseId, concurrentBaseId, independentBaseAId, independentBaseBId];
  const auditIds = (await prisma.eventoAuditoria.findMany({ where: { baseId: { in: baseIds }, usuarioId: userId }, select: { id: true } })).map((event) => event.id);
  if (auditIds.length) await prisma.eventoAuditoria.deleteMany({ where: { id: { in: auditIds } } });
  const importIds = (await prisma.importacionVentas.findMany({ where: { importacionId: { in: [saleImportId, concurrentImportId] } }, select: { id: true } })).map((item) => item.id);
  if (importIds.length) await prisma.ventaExterna.deleteMany({ where: { importacionId: { in: importIds } } });
  if (importIds.length) await prisma.importacionVentas.deleteMany({ where: { id: { in: importIds } } });
  // Reservations are deliberately created by the commercial confirmation
  // cases. Remove only those tied to this run's exact base UUIDs before the
  // bases, otherwise PostgreSQL correctly protects the historical FK.
  await prisma.reservaComercial.deleteMany({ where: { baseId: { in: baseIds } } });
  await prisma.base.deleteMany({ where: { id: { in: baseIds } } });
  await prisma.usuario.deleteMany({ where: { id: userId } });
  const [remainingBases, remainingImports, remainingUsers] = await Promise.all([
    prisma.base.count({ where: { metadatos: { path: ["testRunId"], equals: testRunId } } }),
    prisma.importacionVentas.count({ where: { nombreArchivo: { contains: testRunId } } }),
    prisma.usuario.count({ where: { id: userId } }),
  ]);
  if (remainingBases || remainingImports || remainingUsers) throw new Error("Synthetic fixture cleanup was incomplete.");
  await prisma.$disconnect();
}
