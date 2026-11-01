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
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: testUrl }) });
const testRunId = randomUUID();
const userId = randomUUID();
const blockedBaseId = randomUUID();
const controlBaseId = randomUUID();
const saleImportId = randomUUID();
const saleEventId = randomUUID();
const mobileBlocked = "612345678";
const mobileControl = "712345678";

function metadata(revision: string) {
  return { version: 1, completed: false, revision, originalFileName: `synthetic-${testRunId}.xlsx`, columns: ["Teléfono Movil"], columnMapping: { movil: 0, enriched: {} }, enrichmentColumns: null, enrichmentMode: "preserve", campaignFilters: {}, distribution: { batchSize: 100, selectedCampaigns: ["yoigo"] }, enrichmentSource: null, testRunId };
}
async function createBase(id: string, mobile: string, revision: string) {
  await prisma.base.create({ data: { id, codigo: `P001-${id.slice(0, 8)}`, nombreOriginal: `synthetic-${testRunId}.xlsx`, nombreDescriptivo: "P0-01 integration fixture", estado: "LISTA_PARA_DISTRIBUIR", cantidadImportados: 1, cantidadValidos: 1, cantidadExcluidos: 0, metadatos: metadata(revision), registros: { create: { numeroFilaOriginal: 2, movilNormalizado: mobile, tipificacion: "VALIDO", datosOriginales: { version: 1, cells: [mobile], mobile, contactPhone: "", reason: null, enrichedCells: null, provenance: "EXCEL", testRunId } } } } });
}

try {
  const identity = await prisma.$queryRaw<{ branch_id: string | null }[]>(Prisma.sql`SELECT current_setting('neon.branch_id', true) AS branch_id`);
  if (identity[0]?.branch_id !== expectedBranchId) throw new Error("Test branch identity mismatch.");
  await prisma.usuario.create({ data: { id: userId, username: `complete-save-${testRunId}`, passwordHash: "synthetic-not-a-login-hash", activo: false } });
  const blockedRevision = randomUUID();
  await createBase(blockedBaseId, mobileBlocked, blockedRevision);
  await prisma.importacionVentas.create({ data: { id: saleImportId, importacionId: randomUUID(), huellaContenido: testRunId.replaceAll("-", "").padEnd(64, "0").slice(0, 64), usuarioId: userId, nombreArchivo: `synthetic-${testRunId}.xlsx`, resumen: { synthetic: true, testRunId }, eventos: { create: { id: saleEventId, numeroFilaOrigen: 2, movilNormalizado: mobileBlocked, estado: "CONFIRMADA", resultadoConciliacion: "ENCONTRADO_EN_BASES", metadatos: { synthetic: true, testRunId } } } } });
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
  console.log(JSON.stringify({ target: "test", testRunId, completeBaseSaveInvoked: true, confirmedSaleRejected: true, controlPersisted: true, blockedLots, controlLots }));
} finally {
  await prisma.eventoAuditoria.deleteMany({ where: { baseId: { in: [blockedBaseId, controlBaseId] }, usuarioId: userId } });
  await prisma.ventaExterna.deleteMany({ where: { id: saleEventId } });
  await prisma.importacionVentas.deleteMany({ where: { id: saleImportId } });
  await prisma.base.deleteMany({ where: { id: { in: [blockedBaseId, controlBaseId] } } });
  await prisma.usuario.deleteMany({ where: { id: userId } });
  await prisma.$disconnect();
}
