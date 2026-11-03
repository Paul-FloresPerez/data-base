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

const { beginIntelligentRecycling, previewRecyclingConciliation, appendRecyclingManagements, finalizeIntelligentRecycling, confirmIntelligentRecycling } = await import("../lib/server/recycling-storage.ts");
const { importExternalSales } = await import("../lib/server/sales-storage.ts");
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: testUrl }) });
const testRunId = randomUUID();
const ids = {
  user: randomUUID(), original: randomUUID(), execution: randomUUID(), file: randomUUID(), saleImport: randomUUID(), lot: randomUUID(), reservation: randomUUID(),
};
const mobileSeed = Number.parseInt(testRunId.slice(0, 8), 16);
const syntheticMobile = (offset: number) => `6${((mobileSeed + offset) % 100_000_000).toString().padStart(8, "0")}`;
const mobile = { eligible: syntheticMobile(1), permanence: syntheticMobile(2), sold: syntheticMobile(3), reserved: syntheticMobile(4) };
const operationId = randomUUID();

function metadata() {
  return { version: 1, completed: true, testRunId, originalFileName: "synthetic-recycling.xlsx", columns: ["Teléfono Movil"], enrichmentColumns: ["Teléfono Movil"], columnMapping: { movil: 0, enriched: {} }, distribution: { batchSize: 100, selectedCampaigns: [] } };
}

try {
  const identity = await prisma.$queryRaw<{ branch_id: string | null }[]>(Prisma.sql`SELECT current_setting('neon.branch_id', true) AS branch_id`);
  if (identity[0]?.branch_id !== expectedBranchId) throw new Error("Test branch identity mismatch.");

  await prisma.usuario.create({ data: { id: ids.user, username: `synthetic-recycling-${testRunId}`, passwordHash: "synthetic-not-a-login-hash", activo: false } });
  await prisma.base.create({
    data: {
      id: ids.original, codigo: `R-${testRunId.slice(0, 8)}`, nombreOriginal: "synthetic-recycling.xlsx", nombreDescriptivo: "Synthetic recycling integration", tipo: "ORIGINAL", estado: "LISTA_PARA_DISTRIBUIR", cantidadImportados: 4, cantidadValidos: 4, cantidadExcluidos: 0, metadatos: metadata(),
      registros: { create: [
        { numeroFilaOriginal: 2, movilNormalizado: mobile.eligible, fechaPortabilidad: new Date("2026-06-01T00:00:00.000Z"), tipificacion: "VALIDO", datosOriginales: { testRunId, cells: [mobile.eligible] } },
        { numeroFilaOriginal: 3, movilNormalizado: mobile.permanence, fechaPortabilidad: new Date("2026-09-01T00:00:00.000Z"), tipificacion: "VALIDO", datosOriginales: { testRunId, cells: [mobile.permanence] } },
        { numeroFilaOriginal: 4, movilNormalizado: mobile.sold, fechaPortabilidad: new Date("2026-06-01T00:00:00.000Z"), tipificacion: "VALIDO", datosOriginales: { testRunId, cells: [mobile.sold] } },
        { numeroFilaOriginal: 5, movilNormalizado: mobile.reserved, fechaPortabilidad: new Date("2026-06-01T00:00:00.000Z"), tipificacion: "VALIDO", datosOriginales: { testRunId, cells: [mobile.reserved] } },
      ] },
    },
  });
  await prisma.lote.create({ data: { id: ids.lot, baseId: ids.original, baseOriginalId: ids.original, campana: "YOIGO", numeroLote: 1, cantidadRegistros: 1 } });
  await prisma.reservaComercial.create({ data: { id: ids.reservation, movilNormalizado: mobile.reserved, baseId: ids.original, loteId: ids.lot, campana: "YOIGO", usuarioId: ids.user, operacionId: `synthetic-reservation-${testRunId}`, metadatos: { testRunId } } });
  await importExternalSales({ importId: ids.saleImport, userId: ids.user, fileName: `synthetic-sales-${testRunId}.xlsx`, declaredPeriod: null, sourceFingerprint: testRunId.replaceAll("-", "").padEnd(64, "0").slice(0, 64), events: [{ sourceRow: 2, mobile: mobile.sold, saleStatus: "CONFIRMADA", originalStatus: "CONFIRMADA", reason: "VALIDA", soldAt: null, advisor: null, campaign: null }] });

  const started = await beginIntelligentRecycling({ operationId, baseOriginalId: ids.original, userId: ids.user, criteria: { effectiveDate: "2026-11-03", recyclableTipifications: ["NO CONTESTA", "BUZÓN DE VOZ", "AGENDADO"], minimumMonths: 4, minimumDate: "2019-02-01" }, files: [{ importId: ids.file, name: "CRM_NOVIEMBRE.xlsx" }] });
  if (started.id === "") throw new Error("The execution was not created.");
  const rows = [mobile.eligible, mobile.permanence, mobile.sold, mobile.reserved, "652345678", "912345678"].map((value, index) => ({ fileId: ids.file, fileName: "CRM_NOVIEMBRE.xlsx", sourceRow: index + 2, mobile: value }));
  const conciliation = await previewRecyclingConciliation({ executionId: started.id, userId: ids.user, rows });
  if (conciliation.uniqueFoundMobiles !== 4 || conciliation.uniqueMissingMobiles !== 1 || conciliation.invalidRows !== 1) throw new Error("Conciliation did not distinguish matching, external, and invalid mobiles.");
  const managements = rows.map((row) => ({ importId: ids.file, sourceRow: row.sourceRow, mobile: row.mobile, managedAt: "2026-11-02", tipification: "NO CONTESTA", confirmedSale: false, saleAmbiguous: false, saleEvidence: null, fileName: row.fileName, sheetName: "Datos", zipName: null, internalPath: null }));
  const appended = await appendRecyclingManagements(started.id, ids.user, managements);
  const repeated = await appendRecyclingManagements(started.id, ids.user, managements);
  if (appended.accepted !== 4 || appended.skippedExternal !== 1 || appended.skippedInvalid !== 1 || repeated.accepted !== 0) throw new Error("Management persistence was not idempotent or did not isolate external rows.");
  const evaluated = await finalizeIntelligentRecycling(started.id, ids.user);
  if (evaluated.summary?.ELEGIBLE !== 1 || evaluated.summary?.BLOQUEADO_VENTA !== 1 || evaluated.summary?.REVISION_PERMANENCIA !== 1 || evaluated.summary?.REVISION_CONFLICTO !== 1) throw new Error(`Evaluation did not preserve the eligibility and commercial blocking rules: ${JSON.stringify(evaluated.summary)}`);
  const first = await confirmIntelligentRecycling(started.id, ids.user);
  const second = await confirmIntelligentRecycling(started.id, ids.user);
  if (first.baseId !== second.baseId || !second.reused) throw new Error("Confirmation was not idempotent.");
  const recycled = await prisma.base.findUnique({ where: { id: first.baseId }, include: { registros: true } });
  if (recycled?.registros.length !== 1 || recycled.registros[0]?.movilNormalizado !== mobile.eligible || recycled.baseOriginalId !== ids.original) throw new Error("The recycled base did not copy exactly the eligible source record.");
  console.log(JSON.stringify({ target: "test", testRunId, serviceFlow: true, conciliation: "verified", evaluation: "verified", confirmation: "idempotent", providerCalls: 0 }));
} finally {
  const execution = await prisma.ejecucionReciclaje.findUnique({ where: { operacionId: operationId }, select: { id: true, baseRecicladaId: true } });
  const baseIds = [ids.original, ...(execution?.baseRecicladaId ? [execution.baseRecicladaId] : [])];
  const auditIds = (await prisma.eventoAuditoria.findMany({ where: { usuarioId: ids.user, baseId: { in: baseIds } }, select: { id: true } })).map((event) => event.id);
  if (auditIds.length) await prisma.eventoAuditoria.deleteMany({ where: { id: { in: auditIds } } });
  if (execution) await prisma.resultadoEjecucionReciclaje.deleteMany({ where: { ejecucionId: execution.id } });
  await prisma.gestionTipificacion.deleteMany({ where: { ejecucionOrigenId: execution?.id ?? "00000000-0000-0000-0000-000000000000" } });
  if (execution) await prisma.ejecucionReciclaje.delete({ where: { id: execution.id } });
  await prisma.archivoTipificaciones.deleteMany({ where: { importacionId: ids.file } });
  const salesImport = await prisma.importacionVentas.findUnique({ where: { importacionId: ids.saleImport }, select: { id: true } });
  if (salesImport) { await prisma.ventaExterna.deleteMany({ where: { importacionId: salesImport.id } }); await prisma.importacionVentas.delete({ where: { id: salesImport.id } }); }
  await prisma.reservaComercial.deleteMany({ where: { id: ids.reservation } });
  await prisma.lote.deleteMany({ where: { id: ids.lot } });
  if (execution?.baseRecicladaId) await prisma.base.deleteMany({ where: { id: execution.baseRecicladaId } });
  await prisma.base.deleteMany({ where: { id: ids.original } });
  await prisma.usuario.deleteMany({ where: { id: ids.user } });
  const [remainingBases, remainingExecutions, remainingFiles, remainingSalesImports, remainingReservations, remainingUsers] = await Promise.all([
    prisma.base.count({ where: { metadatos: { path: ["testRunId"], equals: testRunId } } }),
    prisma.ejecucionReciclaje.count({ where: { operacionId: operationId } }),
    prisma.archivoTipificaciones.count({ where: { importacionId: ids.file } }),
    prisma.importacionVentas.count({ where: { importacionId: ids.saleImport } }),
    prisma.reservaComercial.count({ where: { id: ids.reservation } }),
    prisma.usuario.count({ where: { id: ids.user } }),
  ]);
  if (remainingBases || remainingExecutions || remainingFiles || remainingSalesImports || remainingReservations || remainingUsers) throw new Error("Synthetic recycling fixture cleanup was incomplete.");
  await prisma.$disconnect();
}
