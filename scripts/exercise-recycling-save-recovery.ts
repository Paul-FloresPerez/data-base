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
const { beginIntelligentRecycling } = await import("../lib/server/recycling-storage.ts");
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: testUrl }) });
const testRunId = randomUUID();
const ids = { user: randomUUID(), base: randomUUID(), file: randomUUID() };
const mobile = `6${Number.parseInt(testRunId.slice(0, 8), 16).toString().slice(-8).padStart(8, "0")}`;

function storedMetadata(completed: boolean, revision: string | null, enriched = false) {
  return {
    version: 1 as const,
    completed,
    revision,
    originalFileName: `synthetic-recovery-${testRunId}.xlsx`,
    columns: ["Teléfono Movil"],
    columnMapping: { movil: 0, enriched: {} },
    enrichmentColumns: enriched ? ["Teléfono Movil", "Operador Actual"] : null,
    enrichmentMode: "preserve" as const,
    campaignFilters: {},
    distribution: { batchSize: 100, selectedCampaigns: [] },
    enrichmentSource: null,
    kind: "ORIGINAL" as const,
    testRunId,
  };
}

function startPayload(revision: string, enriched = false): SaveStartPayload {
  return {
    id: ids.base,
    name: "Synthetic recovery fixture",
    revision,
    expectedRecords: 1,
    validRecords: 1,
    excludedRecords: 0,
    state: enriched ? "LISTA_PARA_DISTRIBUIR" : "LISTA_PARA_ENRIQUECER",
    receivedAt: null,
    originalBaseId: null,
    metadata: storedMetadata(false, null, enriched),
  };
}

function record(enriched = false): StoredRecord {
  return {
    sourceRow: 2,
    cells: [mobile],
    mobile,
    document: "",
    name: "",
    contactPhone: "",
    normalizedMobile: mobile,
    reason: null,
    tipification: "VALIDO",
    enrichedCells: enriched ? [mobile, "Vodafone"] : null,
    provenance: "EXCEL",
  };
}

try {
  const identity = await prisma.$queryRaw<{ branch_id: string | null }[]>(Prisma.sql`SELECT current_setting('neon.branch_id', true) AS branch_id`);
  if (identity[0]?.branch_id !== expectedBranchId) throw new Error("Test branch identity mismatch.");
  await prisma.usuario.create({ data: { id: ids.user, username: `synthetic-recycling-recovery-${testRunId}`, passwordHash: "synthetic-not-a-login-hash", activo: false } });
  // This models the historical bad state, not a normal import: metadata says
  // complete while every persisted record is still PENDIENTE.
  await prisma.base.create({
    data: {
      id: ids.base,
      codigo: `REC-${testRunId.slice(0, 8)}`,
      nombreOriginal: `synthetic-recovery-${testRunId}.xlsx`,
      nombreDescriptivo: "Synthetic recovery fixture",
      tipo: "ORIGINAL",
      estado: "LISTA_PARA_LIMPIAR",
      cantidadImportados: 1,
      cantidadValidos: 1,
      cantidadExcluidos: 0,
      metadatos: storedMetadata(true, null),
      registros: { create: { numeroFilaOriginal: 2, movilNormalizado: null, tipificacion: "PENDIENTE", datosOriginales: { version: 1, cells: [mobile], mobile, contactPhone: "", reason: null, enrichedCells: null, provenance: "EXCEL", testRunId } } },
    },
  });

  let uncleanBaseRejected = false;
  try {
    await beginIntelligentRecycling({
      operationId: randomUUID(),
      baseOriginalId: ids.base,
      userId: ids.user,
      criteria: { effectiveDate: "2026-11-03", recyclableTipifications: ["NO CONTESTA"], minimumMonths: 4, minimumDate: "2019-02-01" },
      files: [{ importId: ids.file, name: "synthetic-crm.xlsx" }],
    });
  } catch (error) {
    uncleanBaseRejected = error instanceof Error && /limpieza guardada correctamente/.test(error.message);
  }
  if (!uncleanBaseRejected) throw new Error("An incomplete original base was accepted for recycling.");

  const revision = randomUUID();
  await beginBaseSave(startPayload(revision));
  if (!await saveRecordChunk(ids.base, revision, [record()])) throw new Error("Recovered base did not accept its cleaned record.");
  if (!await completeBaseSave(ids.base, revision, [], ids.user)) throw new Error("Recovered base did not complete.");
  const recovered = await prisma.base.findUnique({ where: { id: ids.base }, include: { registros: true } });
  const recoveredCompleted = Boolean((recovered?.metadatos as { completed?: boolean } | null)?.completed);
  if (recovered?.estado !== "LISTA_PARA_ENRIQUECER" || !recoveredCompleted || recovered.registros.length !== 1 || recovered.registros[0]?.movilNormalizado !== mobile || recovered.registros[0]?.tipificacion !== "VALIDO") {
    throw new Error("Recovery did not replace the incomplete state with the cleaned record set.");
  }
  // A normal base may be saved after cleaning and again after enrichment. It
  // has no commercial lot yet, so the second persistence must replace only its
  // operational snapshot and must not report it as an immutable distribution.
  const enrichmentRevision = randomUUID();
  await beginBaseSave(startPayload(enrichmentRevision, true));
  if (!await saveRecordChunk(ids.base, enrichmentRevision, [record(true)])) throw new Error("Completed operational base did not accept its enrichment revision.");
  if (!await completeBaseSave(ids.base, enrichmentRevision, [], ids.user)) throw new Error("Enriched operational base did not complete.");
  const enrichedBase = await prisma.base.findUnique({ where: { id: ids.base }, include: { registros: true } });
  const enrichedMetadata = enrichedBase?.metadatos as { completed?: boolean; commercialDistributionConfirmed?: boolean } | null;
  if (enrichedBase?.estado !== "LISTA_PARA_DISTRIBUIR" || !enrichedMetadata?.completed || enrichedMetadata.commercialDistributionConfirmed || enrichedBase.registros.length !== 1 || (enrichedBase.registros[0]?.datosOriginales as { enrichedCells?: unknown[] }).enrichedCells?.[1] !== "Vodafone") {
    throw new Error("An editable operational save did not retain its enriched snapshot correctly.");
  }
  console.log(JSON.stringify({ target: "test", testRunId, incompleteBaseRejected: true, recoveryCompleted: true, enrichedResaveCompleted: true, commercialLots: 0, providerCalls: 0 }));
} finally {
  const auditIds = (await prisma.eventoAuditoria.findMany({ where: { baseId: ids.base, usuarioId: ids.user }, select: { id: true } })).map((item) => item.id);
  if (auditIds.length) await prisma.eventoAuditoria.deleteMany({ where: { id: { in: auditIds } } });
  await prisma.archivoTipificaciones.deleteMany({ where: { importacionId: ids.file } });
  await prisma.base.deleteMany({ where: { id: ids.base } });
  await prisma.usuario.deleteMany({ where: { id: ids.user } });
  const [bases, users, files] = await Promise.all([
    prisma.base.count({ where: { id: ids.base } }),
    prisma.usuario.count({ where: { id: ids.user } }),
    prisma.archivoTipificaciones.count({ where: { importacionId: ids.file } }),
  ]);
  if (bases || users || files) throw new Error("Synthetic recycling recovery fixture cleanup was incomplete.");
  await prisma.$disconnect();
}
