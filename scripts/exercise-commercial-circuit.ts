import { createHash, randomUUID } from "node:crypto";
import nextEnv from "@next/env";
import { PrismaNeon } from "@prisma/adapter-neon";
import { Prisma, PrismaClient, type TipificacionRegistro } from "../generated/prisma/client.ts";
import type { LoadedBase } from "../lib/persistence/workspace-persistence.ts";

nextEnv.loadEnvConfig(process.cwd());

const testUrl = process.env.PRISMA_MIGRATION_TEST_URL;
const expectedBranchId = process.env.PRISMA_MIGRATION_TEST_BRANCH_ID;
if (!testUrl || !expectedBranchId) throw new Error("Dedicated Test configuration is required.");
process.env.DATABASE_URL = testUrl;
process.env.DATABASE_URL_UNPOOLED = testUrl;

const {
  beginIntelligentRecycling,
  previewRecyclingConciliation,
  appendRecyclingManagements,
  finalizeIntelligentRecycling,
  confirmIntelligentRecycling,
  getRecyclingExecution,
} = await import("../lib/server/recycling-storage.ts");
const { importExternalSales } = await import("../lib/server/sales-storage.ts");
const { beginBaseSave, completeBaseSave, getSavedBase, saveRecordChunk } = await import("../lib/server/base-storage.ts");
const { buildStoredLots, restoreBatch, serializeBatch } = await import("../lib/persistence/workspace-persistence.ts");
const { prepareCommercialExport } = await import("../lib/server/commercial-export-storage.ts");
const { buildCrmRecyclingOutput, CRM_RECYCLING_HEADERS } = await import("../lib/export/crm-recycling-export.ts");

const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: testUrl }) });
const testRunId = randomUUID();
const ids = {
  user: randomUUID(),
  original: randomUUID(),
  reservationLot: randomUUID(),
  reservation: randomUUID(),
  saleImport: randomUUID(),
  firstExecution: randomUUID(),
  secondExecution: randomUUID(),
  firstFile: randomUUID(),
  secondFile: randomUUID(),
};

const mobileSeed = Number.parseInt(createHash("sha256").update(testRunId).digest("hex").slice(0, 8), 16);
const mobile = (offset: number) => `6${((mobileSeed + offset) % 100_000_000).toString().padStart(8, "0")}`;
const mobiles = {
  yoigo: mobile(1),
  vodafone: mobile(2),
  later: mobile(3),
  sold: mobile(4),
  reserved: mobile(5),
  external: mobile(6),
};

const sourceColumns = ["Teléfono Movil", "Nombres", "Numero Doc"];
const enrichmentColumns = [...sourceColumns, "Operador Actual", "Operador Original", "Portabilidad Desde", "Fecha Portabilidad", "Año", "Mes", "Dia"];
const operationFingerprint = (label: string) => createHash("sha256").update(`${testRunId}:${label}`).digest("hex");

function metadata() {
  return {
    version: 1,
    completed: true,
    revision: null,
    originalFileName: `synthetic-circuit-${testRunId}.xlsx`,
    columns: sourceColumns,
    columnMapping: { movil: 0, nombre: 1, documento: 2, enriched: {} },
    enrichmentColumns,
    enrichmentMode: "preserve",
    campaignFilters: {},
    distribution: { batchSize: 100, selectedCampaigns: ["yoigo", "vodafone"] },
    enrichmentSource: "api_real",
    kind: "ORIGINAL",
    testRunId,
  };
}

function enrichedCells(mobileNumber: string, operator: string, date: string) {
  const [year, month, day] = date.split("-");
  return [mobileNumber, "Cliente sintético", "000001", operator, operator, "", date, year!, month!, day!];
}

function originalRecord(sourceRow: number, mobileNumber: string | null, operator: string, date: string, tipification: TipificacionRegistro = "VALIDO") {
  return {
    numeroFilaOriginal: sourceRow,
    movilNormalizado: mobileNumber,
    nombre: "Cliente sintético",
    documento: "000001",
    operadorActual: operator,
    operadorOriginal: operator,
    fechaPortabilidad: new Date(`${date}T00:00:00.000Z`),
    tipificacion: tipification,
    datosOriginales: {
      version: 1,
      cells: [mobileNumber ?? "912345678", "Cliente sintético", "000001"],
      mobile: mobileNumber ?? "912345678",
      contactPhone: "",
      reason: tipification === "VALIDO" ? null : "telefono_invalido",
      enrichedCells: enrichedCells(mobileNumber ?? "912345678", operator, date),
      provenance: "API_REAL",
    },
  };
}

async function assertTestBranch() {
  const identity = await prisma.$queryRaw<{ branch_id: string | null }[]>(Prisma.sql`SELECT current_setting('neon.branch_id', true) AS branch_id`);
  if (identity[0]?.branch_id !== expectedBranchId) throw new Error("Test branch identity mismatch.");
}

async function appendManagements(executionId: string, importId: string, fileName: string, rows: { mobile: string; date: string; tipification: string }[]) {
  const conciliationRows = rows.map((row, index) => ({ fileId: importId, fileName, sourceRow: index + 2, mobile: row.mobile }));
  return {
    conciliation: await previewRecyclingConciliation({ executionId, userId: ids.user, rows: conciliationRows }),
    appended: await appendRecyclingManagements(executionId, ids.user, rows.map((row, index) => ({
      importId,
      sourceRow: index + 2,
      mobile: row.mobile,
      managedAt: row.date,
      tipification: row.tipification,
      confirmedSale: false,
      saleAmbiguous: false,
      saleEvidence: null,
      fileName,
      sheetName: "Datos",
      zipName: null,
      internalPath: null,
    }))),
  };
}

let recycledBaseId: string | null = null;

try {
  await assertTestBranch();
  await prisma.usuario.create({ data: { id: ids.user, username: `synthetic-circuit-${testRunId}`, passwordHash: "synthetic-not-a-login-hash", activo: false } });
  await prisma.base.create({
    data: {
      id: ids.original,
      codigo: `C-${testRunId.slice(0, 8)}`,
      nombreOriginal: `synthetic-circuit-${testRunId}.xlsx`,
      nombreDescriptivo: "Circuito comercial sintético",
      tipo: "ORIGINAL",
      estado: "LISTA_PARA_DISTRIBUIR",
      cantidadImportados: 7,
      cantidadValidos: 5,
      cantidadExcluidos: 2,
      metadatos: metadata(),
      registros: {
        create: [
          originalRecord(2, mobiles.yoigo, "Vodafone", "2026-06-01"),
          originalRecord(3, mobiles.vodafone, "Orange", "2026-06-01"),
          originalRecord(4, mobiles.later, "Movistar", "2026-07-03"),
          originalRecord(5, mobiles.sold, "Vodafone", "2026-06-01"),
          originalRecord(6, mobiles.reserved, "Orange", "2026-06-01"),
          originalRecord(7, mobiles.yoigo, "Vodafone", "2026-06-01", "TELEFONO_DUPLICADO"),
          originalRecord(8, null, "Vodafone", "2026-06-01", "TELEFONO_INVALIDO"),
        ],
      },
    },
  });
  await prisma.lote.create({ data: { id: ids.reservationLot, baseId: ids.original, baseOriginalId: ids.original, campana: "YOIGO", numeroLote: 1, cantidadRegistros: 1 } });
  await prisma.reservaComercial.create({ data: { id: ids.reservation, movilNormalizado: mobiles.reserved, baseId: ids.original, loteId: ids.reservationLot, campana: "YOIGO", usuarioId: ids.user, operacionId: `synthetic-circuit-reservation:${testRunId}`, metadatos: { testRunId } } });
  await importExternalSales({
    importId: ids.saleImport,
    userId: ids.user,
    fileName: `synthetic-sales-${testRunId}.xlsx`,
    declaredPeriod: null,
    sourceFingerprint: operationFingerprint("sales"),
    events: [{ sourceRow: 2, mobile: mobiles.sold, saleStatus: "CONFIRMADA", originalStatus: "CONFIRMADA", reason: "VALIDA", soldAt: null, advisor: null, campaign: null }],
  });

  const first = await beginIntelligentRecycling({
    operationId: ids.firstExecution,
    baseOriginalId: ids.original,
    userId: ids.user,
    criteria: { effectiveDate: "2026-11-02", recyclableTipifications: ["NO CONTESTA", "BUZÓN DE VOZ", "AGENDADO"], minimumMonths: 4, minimumDate: "2019-02-01" },
    files: [{ importId: ids.firstFile, name: "CRM_OCTUBRE_DISTINTO.xlsx" }],
  });
  const firstRows = [
    { mobile: mobiles.yoigo, date: "2026-10-10", tipification: "NO CONTESTA" },
    { mobile: mobiles.vodafone, date: "2026-10-10", tipification: "BUZÓN DE VOZ" },
    { mobile: mobiles.later, date: "2026-10-10", tipification: "AGENDADO" },
    { mobile: mobiles.sold, date: "2026-10-10", tipification: "NO CONTESTA" },
    { mobile: mobiles.reserved, date: "2026-10-10", tipification: "AGENDADO" },
    { mobile: mobiles.external, date: "2026-10-10", tipification: "NO CONTESTA" },
    { mobile: "912345678", date: "2026-10-10", tipification: "NO CONTESTA" },
  ];
  const firstImport = await appendManagements(first.id, ids.firstFile, "CRM_OCTUBRE_DISTINTO.xlsx", firstRows);
  if (firstImport.conciliation.uniqueFoundMobiles !== 5 || firstImport.conciliation.uniqueMissingMobiles !== 1 || firstImport.conciliation.invalidRows !== 1 || firstImport.appended.accepted !== 5) {
    throw new Error("CRM conciliation did not distinguish original, external, and invalid rows.");
  }
  const firstEvaluation = await finalizeIntelligentRecycling(first.id, ids.user);
  if (firstEvaluation.summary?.ELEGIBLE !== 2 || firstEvaluation.summary?.REVISION_PERMANENCIA !== 1 || firstEvaluation.summary?.BLOQUEADO_VENTA !== 1 || firstEvaluation.summary?.REVISION_CONFLICTO !== 1) {
    throw new Error("First historical execution did not retain expected commercial decisions.");
  }
  const firstHistory = await getRecyclingExecution(first.id);

  const second = await beginIntelligentRecycling({
    operationId: ids.secondExecution,
    baseOriginalId: ids.original,
    userId: ids.user,
    criteria: { effectiveDate: "2026-11-03", recyclableTipifications: ["NO CONTESTA", "BUZÓN DE VOZ", "AGENDADO"], minimumMonths: 4, minimumDate: "2019-02-01" },
    files: [{ importId: ids.secondFile, name: "CRM_NOVIEMBRE_OTRA_NOMENCLATURA.xlsx" }],
  });
  const secondRows = [...firstRows, { mobile: mobiles.yoigo, date: "2026-11-01", tipification: "NO CONTESTA" }];
  const secondImport = await appendManagements(second.id, ids.secondFile, "CRM_NOVIEMBRE_OTRA_NOMENCLATURA.xlsx", secondRows);
  if (secondImport.appended.accepted !== 6) throw new Error("The second CRM history was not persisted independently.");
  const secondEvaluation = await finalizeIntelligentRecycling(second.id, ids.user);
  if (secondEvaluation.summary?.ELEGIBLE !== 3 || secondEvaluation.summary?.BLOQUEADO_VENTA !== 1 || secondEvaluation.summary?.REVISION_CONFLICTO !== 1 || secondEvaluation.summary?.evaluated !== 5) {
    throw new Error("The later execution did not reevaluate permanence or exclude invalid and duplicate source records.");
  }
  const firstHistoryAgain = await getRecyclingExecution(first.id);
  if (JSON.stringify(firstHistory.summary) !== JSON.stringify(firstHistoryAgain.summary)) throw new Error("A later CRM file changed the prior immutable execution.");

  const confirmed = await confirmIntelligentRecycling(second.id, ids.user);
  const retriedConfirmation = await confirmIntelligentRecycling(second.id, ids.user);
  if (confirmed.reused || confirmed.baseId !== retriedConfirmation.baseId || !retriedConfirmation.reused) throw new Error("Recycling confirmation was not idempotent.");
  recycledBaseId = confirmed.baseId;
  const recycledBeforeDistribution = await getSavedBase(recycledBaseId);
  if (!recycledBeforeDistribution || recycledBeforeDistribution.records.length !== 3) throw new Error("Generated recycled base did not contain exactly eligible original records.");

  const batch = restoreBatch(recycledBeforeDistribution as LoadedBase);
  batch.distribution = { batchSize: 100, selectedCampaigns: ["yoigo", "vodafone"] };
  const persisted = serializeBatch(batch, batch.displayName ?? "Reciclada sintética");
  await beginBaseSave(persisted.start);
  if (!await saveRecordChunk(persisted.start.id, persisted.start.revision, persisted.records)) throw new Error("The recycled distribution revision could not store its source records.");
  const lots = buildStoredLots(batch);
  if (!lots.length || lots.some((lot) => lot.sourceRows.length > 100)) throw new Error("Commercial lot construction exceeded its limit or produced no eligible lots.");
  if (!await completeBaseSave(persisted.start.id, persisted.start.revision, lots, ids.user)) throw new Error("Confirmed recycling base did not continue into commercial distribution.");

  const snapshot = await prepareCommercialExport({ baseId: recycledBaseId, userId: ids.user });
  const output = buildCrmRecyclingOutput({ columns: snapshot.columns, rows: snapshot.lots.flatMap((lot) => lot.rows) });
  if (snapshot.lots.reduce((total, lot) => total + lot.rows.length, 0) !== 3 || JSON.stringify(output.columns) !== JSON.stringify(CRM_RECYCLING_HEADERS)) {
    throw new Error("Commercial export did not preserve its confirmed rows or exact CRM headers.");
  }
  const retriedExport = await prepareCommercialExport({ baseId: recycledBaseId, userId: ids.user });
  if (retriedExport.lots.length !== snapshot.lots.length) throw new Error("Commercial download retry was not idempotent.");
  const activeReservations = await prisma.reservaComercial.count({ where: { baseId: recycledBaseId, estado: "ACTIVA" } });
  if (activeReservations !== 3) throw new Error("Confirmed commercial export lacks matching active reservations.");

  console.log(JSON.stringify({ target: "test", testRunId, fullCircuit: true, historicalExecutions: 2, recycledRecords: 3, commercialLots: lots.length, crmHeaders: 24, providerCalls: 0 }));
} finally {
  const baseIds = [ids.original, ...(recycledBaseId ? [recycledBaseId] : [])];
  const executionIds = (await prisma.ejecucionReciclaje.findMany({ where: { operacionId: { in: [ids.firstExecution, ids.secondExecution] } }, select: { id: true } })).map((entry) => entry.id);
  const auditIds = (await prisma.eventoAuditoria.findMany({ where: { usuarioId: ids.user, baseId: { in: baseIds } }, select: { id: true } })).map((entry) => entry.id);
  if (auditIds.length) await prisma.eventoAuditoria.deleteMany({ where: { id: { in: auditIds } } });
  if (executionIds.length) await prisma.resultadoEjecucionReciclaje.deleteMany({ where: { ejecucionId: { in: executionIds } } });
  if (executionIds.length) await prisma.gestionTipificacion.deleteMany({ where: { ejecucionOrigenId: { in: executionIds } } });
  if (executionIds.length) await prisma.ejecucionReciclaje.deleteMany({ where: { id: { in: executionIds } } });
  await prisma.archivoTipificaciones.deleteMany({ where: { importacionId: { in: [ids.firstFile, ids.secondFile] } } });
  const saleImports = (await prisma.importacionVentas.findMany({ where: { importacionId: ids.saleImport }, select: { id: true } })).map((entry) => entry.id);
  if (saleImports.length) await prisma.ventaExterna.deleteMany({ where: { importacionId: { in: saleImports } } });
  if (saleImports.length) await prisma.importacionVentas.deleteMany({ where: { id: { in: saleImports } } });
  await prisma.registroExportacion.deleteMany({ where: { baseId: { in: baseIds } } });
  await prisma.reservaComercial.deleteMany({ where: { baseId: { in: baseIds } } });
  await prisma.lote.deleteMany({ where: { baseId: { in: baseIds } } });
  if (recycledBaseId) await prisma.base.deleteMany({ where: { id: recycledBaseId } });
  await prisma.base.deleteMany({ where: { id: ids.original } });
  await prisma.usuario.deleteMany({ where: { id: ids.user } });
  const leftovers = await Promise.all([
    prisma.base.count({ where: { metadatos: { path: ["testRunId"], equals: testRunId } } }),
    prisma.ejecucionReciclaje.count({ where: { operacionId: { in: [ids.firstExecution, ids.secondExecution] } } }),
    prisma.archivoTipificaciones.count({ where: { importacionId: { in: [ids.firstFile, ids.secondFile] } } }),
    prisma.importacionVentas.count({ where: { importacionId: ids.saleImport } }),
    prisma.usuario.count({ where: { id: ids.user } }),
  ]);
  if (leftovers.some(Boolean)) throw new Error("Commercial circuit fixture cleanup was incomplete.");
  await prisma.$disconnect();
}
