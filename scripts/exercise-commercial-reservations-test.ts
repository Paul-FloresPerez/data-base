import { createHash, randomUUID } from "node:crypto";
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
const { releaseCommercialReservation } = await import("../lib/server/commercial-reservation-storage.ts");
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: testUrl }) });
const testRunId = randomUUID();
const userId = randomUUID();
const baseIds = Array.from({ length: 7 }, () => randomUUID());
const saleImportId = randomUUID();

function metadata(revision: string) {
  return {
    version: 1, completed: false, revision,
    originalFileName: `synthetic-reservation-${testRunId}.xlsx`, columns: ["Teléfono Movil"], columnMapping: { movil: 0, enriched: {} },
    enrichmentColumns: ["Operador Actual"], enrichmentMode: "preserve", campaignFilters: {}, distribution: { batchSize: 100, selectedCampaigns: ["yoigo", "vodafone"] }, enrichmentSource: "api_real", testRunId,
  };
}

async function createBase(baseId: string, mobile: string, operator: string, revision: string) {
  await prisma.base.create({ data: {
    id: baseId, codigo: `P101-${baseId.slice(0, 8)}`, nombreOriginal: `synthetic-reservation-${testRunId}.xlsx`, nombreDescriptivo: "P1-02 fixture", estado: "LISTA_PARA_DISTRIBUIR",
    cantidadImportados: 1, cantidadValidos: 1, cantidadExcluidos: 0, metadatos: metadata(revision),
    registros: { create: { numeroFilaOriginal: 2, movilNormalizado: mobile, operadorActual: operator, tipificacion: "VALIDO", datosOriginales: { version: 1, cells: [mobile], mobile, contactPhone: "", reason: null, enrichedCells: [operator], provenance: "API_REAL", testRunId } } },
  } });
}

function lot(campaign: "YOIGO" | "VODAFONE") { return [{ campaign, number: 1, sourceRows: [2] }]; }
function fingerprint(seed: string) { return seed.replaceAll("-", "").padEnd(64, "0").slice(0, 64); }
function mobile(label: string) {
  const value = Number.parseInt(createHash("sha256").update(`${testRunId}:${label}`).digest("hex").slice(0, 8), 16) % 100_000_000;
  return `6${String(value).padStart(8, "0")}`;
}

try {
  const identity = await prisma.$queryRaw<{ branch_id: string | null }[]>(Prisma.sql`SELECT current_setting('neon.branch_id', true) AS branch_id`);
  if (identity[0]?.branch_id !== expectedBranchId) throw new Error("Test branch identity mismatch.");
  await prisma.usuario.create({ data: { id: userId, username: `synthetic-reservation-${testRunId}`, passwordHash: "synthetic-not-a-login-hash", activo: false } });

  const sharedMobile = mobile("shared");
  const revisionA = randomUUID();
  await createBase(baseIds[0]!, sharedMobile, "Vodafone", revisionA);
  if (!await completeBaseSave(baseIds[0]!, revisionA, lot("YOIGO"), userId)) throw new Error("Initial distribution did not persist.");
  const initialReservation = await prisma.reservaComercial.findFirstOrThrow({ where: { baseId: baseIds[0]!, movilNormalizado: sharedMobile, estado: "ACTIVA" } });
  if (!initialReservation.loteId || initialReservation.campana !== "YOIGO" || initialReservation.usuarioId !== userId) throw new Error("Reservation traceability is incomplete.");

  const revisionB = randomUUID();
  await createBase(baseIds[1]!, sharedMobile, "Vodafone", revisionB);
  let duplicateRejected = false;
  try { await completeBaseSave(baseIds[1]!, revisionB, lot("YOIGO"), userId); } catch { duplicateRejected = true; }
  const duplicateLots = await prisma.lote.count({ where: { baseId: baseIds[1]! } });
  if (!duplicateRejected || duplicateLots !== 0) throw new Error("A second base obtained an active reservation.");

  const revisionCrossCampaign = randomUUID();
  await createBase(baseIds[2]!, sharedMobile, "Orange", revisionCrossCampaign);
  let crossCampaignRejected = false;
  try { await completeBaseSave(baseIds[2]!, revisionCrossCampaign, lot("VODAFONE"), userId); } catch { crossCampaignRejected = true; }
  if (!crossCampaignRejected || await prisma.lote.count({ where: { baseId: baseIds[2]! } })) throw new Error("A second campaign bypassed the active reservation.");

  const releaseOperation = randomUUID();
  if (!await releaseCommercialReservation({ id: initialReservation.id, userId, operationId: releaseOperation })) throw new Error("Explicit release failed.");
  if (!await releaseCommercialReservation({ id: initialReservation.id, userId, operationId: releaseOperation })) throw new Error("Release retry was not idempotent.");
  const released = await prisma.reservaComercial.findUniqueOrThrow({ where: { id: initialReservation.id } });
  if (released.estado !== "LIBERADA" || !released.liberadaEn) throw new Error("Released reservation lost historical traceability.");
  if (!await completeBaseSave(baseIds[1]!, revisionB, lot("YOIGO"), userId)) throw new Error("A released mobile could not be re-evaluated.");
  if (await completeBaseSave(baseIds[1]!, revisionB, lot("YOIGO"), userId)) throw new Error("Retry duplicated an already confirmed reservation.");

  const saleMobile = mobile("sale");
  const revisionSale = randomUUID();
  await createBase(baseIds[3]!, saleMobile, "Vodafone", revisionSale);
  await importExternalSales({ importId: saleImportId, userId, fileName: `synthetic-sale-${testRunId}.xlsx`, declaredPeriod: null, sourceFingerprint: fingerprint(`${testRunId}sale`), events: [{ sourceRow: 2, mobile: saleMobile, saleStatus: "CONFIRMADA", originalStatus: "CONFIRMADA", reason: "VALIDA", soldAt: null, advisor: null, campaign: "YOIGO" }] });
  let saleRejected = false;
  try { await completeBaseSave(baseIds[3]!, revisionSale, lot("YOIGO"), userId); } catch { saleRejected = true; }
  if (!saleRejected || await prisma.reservaComercial.count({ where: { baseId: baseIds[3]! } })) throw new Error("Confirmed sale did not block reservation atomically.");

  const concurrentMobile = mobile("concurrent");
  const revisionConcurrentA = randomUUID();
  const revisionConcurrentB = randomUUID();
  await Promise.all([
    createBase(baseIds[4]!, concurrentMobile, "Vodafone", revisionConcurrentA),
    createBase(baseIds[5]!, concurrentMobile, "Vodafone", revisionConcurrentB),
  ]);
  const concurrent = await Promise.allSettled([
    completeBaseSave(baseIds[4]!, revisionConcurrentA, lot("YOIGO"), userId),
    completeBaseSave(baseIds[5]!, revisionConcurrentB, lot("YOIGO"), userId),
  ]);
  const concurrentActive = await prisma.reservaComercial.count({ where: { movilNormalizado: concurrentMobile, estado: "ACTIVA" } });
  const concurrentLots = await prisma.lote.count({ where: { baseId: { in: [baseIds[4]!, baseIds[5]!] } } });
  if (concurrent.filter((result) => result.status === "fulfilled" && result.value).length !== 1 || concurrentActive !== 1 || concurrentLots !== 1) {
    throw new Error("Concurrent requests created inconsistent active reservations.");
  }

  console.log(JSON.stringify({ target: "test", testRunId, initialReserved: true, duplicateRejected, crossCampaignRejected, releaseIdempotent: true, reReservedAfterRelease: true, saleRejected, concurrentSingleActiveReservation: true }));
} finally {
  const auditIds = (await prisma.eventoAuditoria.findMany({ where: { baseId: { in: baseIds }, usuarioId: userId }, select: { id: true } })).map((event) => event.id);
  if (auditIds.length) await prisma.eventoAuditoria.deleteMany({ where: { id: { in: auditIds } } });
  await prisma.reservaComercial.deleteMany({ where: { baseId: { in: baseIds } } });
  const importIds = (await prisma.importacionVentas.findMany({ where: { importacionId: saleImportId }, select: { id: true } })).map((entry) => entry.id);
  if (importIds.length) await prisma.ventaExterna.deleteMany({ where: { importacionId: { in: importIds } } });
  if (importIds.length) await prisma.importacionVentas.deleteMany({ where: { id: { in: importIds } } });
  await prisma.base.deleteMany({ where: { id: { in: baseIds } } });
  await prisma.usuario.deleteMany({ where: { id: userId } });
  const [bases, reservations, user] = await Promise.all([
    prisma.base.count({ where: { metadatos: { path: ["testRunId"], equals: testRunId } } }),
    prisma.reservaComercial.count({ where: { baseId: { in: baseIds } } }),
    prisma.usuario.count({ where: { id: userId } }),
  ]);
  if (bases || reservations || user) throw new Error("Commercial reservation fixture cleanup was incomplete.");
  await prisma.$disconnect();
}
