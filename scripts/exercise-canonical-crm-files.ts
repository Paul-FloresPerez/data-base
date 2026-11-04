import { randomUUID } from "node:crypto";
import nextEnv from "@next/env";
import { PrismaNeon } from "@prisma/adapter-neon";
import { Prisma, PrismaClient } from "../generated/prisma/client.ts";
import { associateCanonicalCrmFile } from "../lib/server/canonical-crm-storage.ts";

nextEnv.loadEnvConfig(process.cwd());
const testUrl = process.env.PRISMA_MIGRATION_TEST_URL;
const expectedBranchId = process.env.PRISMA_MIGRATION_TEST_BRANCH_ID;
if (!testUrl || !expectedBranchId) throw new Error("Dedicated Test configuration is required.");

const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: testUrl }) });
const testRunId = randomUUID();
const userlessMetadata = { synthetic: true, testRunId };
const baseAId = randomUUID();
const baseBId = randomUUID();
const recycledBaseId = randomUUID();
const legacyFileId = randomUUID();
const canonicalFileId = randomUUID();
const legacyImportId = `synthetic-legacy-${testRunId}`;
const canonicalImportId = `synthetic-canonical-${testRunId}`;

function baseData(id: string, label: string, tipo: "ORIGINAL" | "RECICLADA", baseOriginalId?: string) {
  return {
    id,
    codigo: `RG1-${id.slice(0, 8)}`,
    nombreOriginal: `synthetic-${label}-${testRunId}.xlsx`,
    nombreDescriptivo: `RG-1 ${label}`,
    tipo,
    baseOriginalId,
    cantidadImportados: 0,
    cantidadValidos: 0,
    cantidadExcluidos: 0,
    metadatos: userlessMetadata,
  };
}

try {
  const identity = await prisma.$queryRaw<{ branch_id: string | null }[]>(Prisma.sql`SELECT current_setting('neon.branch_id', true) AS branch_id`);
  if (identity[0]?.branch_id !== expectedBranchId) throw new Error("Test branch identity mismatch.");

  await prisma.base.createMany({ data: [
    baseData(baseAId, "original-a", "ORIGINAL"),
    baseData(baseBId, "original-b", "ORIGINAL"),
    baseData(recycledBaseId, "recycled", "RECICLADA", baseAId),
  ] });
  await prisma.archivoTipificaciones.create({ data: {
    id: legacyFileId,
    importacionId: legacyImportId,
    baseId: baseAId,
    nombreArchivo: `synthetic-legacy-${testRunId}.xlsx`,
    resumen: userlessMetadata,
  } });
  const legacyManagement = await prisma.gestionTipificacion.create({ data: {
    archivoId: legacyFileId,
    baseOriginalId: baseAId,
    numeroFilaOrigen: 2,
    movilNormalizado: "612345678",
    tipificacionOriginal: "NO RESPONDE",
    metadatos: userlessMetadata,
  } });

  await prisma.archivoCrmCanonico.create({ data: {
    id: canonicalFileId,
    importacionId: canonicalImportId,
    huellaContenido: `rg1-${testRunId.replaceAll("-", "")}`,
    nombreArchivo: `synthetic-shared-crm-${testRunId}.xlsx`,
    archivoTipificacionesLegacyId: legacyFileId,
    metadatos: userlessMetadata,
    filas: { create: [
      { hojaOrigen: "Datos", numeroFilaOrigen: 2, movilNormalizado: "612345678", datosOriginales: userlessMetadata, metadatos: userlessMetadata },
      { hojaOrigen: "Datos", numeroFilaOrigen: 3, movilNormalizado: "623456789", datosOriginales: userlessMetadata, metadatos: userlessMetadata },
    ] },
  } });

  const associationA = await associateCanonicalCrmFile(prisma, {
    archivoCrmId: canonicalFileId,
    baseOriginalId: baseAId,
    resumenConciliacion: { matched: 1, unmatched: 1, testRunId },
    metadatos: userlessMetadata,
  });
  const repeatedAssociationA = await associateCanonicalCrmFile(prisma, {
    archivoCrmId: canonicalFileId,
    baseOriginalId: baseAId,
    metadatos: userlessMetadata,
  });
  const associationB = await associateCanonicalCrmFile(prisma, {
    archivoCrmId: canonicalFileId,
    baseOriginalId: baseBId,
    resumenConciliacion: { matched: 1, unmatched: 1, testRunId },
    metadatos: userlessMetadata,
  });
  if (associationA.id !== repeatedAssociationA.id || associationA.id === associationB.id) {
    throw new Error("Canonical association idempotency failed.");
  }

  let recycledRejected = false;
  try {
    await associateCanonicalCrmFile(prisma, {
      archivoCrmId: canonicalFileId,
      baseOriginalId: recycledBaseId,
      metadatos: userlessMetadata,
    });
  } catch {
    recycledRejected = true;
  }
  if (!recycledRejected) throw new Error("A RECICLADA base was accepted as a canonical association target.");

  let missingBaseRejected = false;
  try {
    await prisma.archivoCrmBase.create({ data: {
      archivoCrmId: canonicalFileId,
      baseOriginalId: randomUUID(),
      metadatos: userlessMetadata,
    } });
  } catch (error) {
    missingBaseRejected = error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003";
  }
  if (!missingBaseRejected) throw new Error("The canonical association foreign key did not reject an unknown base.");

  const [associationCount, rowCount, legacyStillPresent] = await Promise.all([
    prisma.archivoCrmBase.count({ where: { archivoCrmId: canonicalFileId } }),
    prisma.filaArchivoCrm.count({ where: { archivoCrmId: canonicalFileId } }),
    prisma.gestionTipificacion.findFirst({ where: { id: legacyManagement.id, archivoId: legacyFileId, baseOriginalId: baseAId }, select: { id: true } }),
  ]);
  if (associationCount !== 2 || rowCount !== 2 || !legacyStillPresent) {
    throw new Error("Canonical file provenance or legacy compatibility failed.");
  }

  console.log(JSON.stringify({ target: "test", testRunId, associations: associationCount, rows: rowCount, reimportIdempotent: true, legacyPreserved: true, invalidAssociationRejected: true, foreignKeyRejected: true }));
} finally {
  await prisma.filaArchivoCrm.deleteMany({ where: { archivoCrmId: canonicalFileId } });
  await prisma.archivoCrmBase.deleteMany({ where: { archivoCrmId: canonicalFileId } });
  await prisma.archivoCrmCanonico.deleteMany({ where: { id: canonicalFileId } });
  await prisma.gestionTipificacion.deleteMany({ where: { archivoId: legacyFileId } });
  await prisma.archivoTipificaciones.deleteMany({ where: { id: legacyFileId } });
  await prisma.base.deleteMany({ where: { id: { in: [baseAId, baseBId, recycledBaseId] } } });
  const [files, bases] = await Promise.all([
    prisma.archivoCrmCanonico.count({ where: { importacionId: canonicalImportId } }),
    prisma.base.count({ where: { id: { in: [baseAId, baseBId, recycledBaseId] } } }),
  ]);
  if (files || bases) throw new Error("Canonical CRM fixture cleanup was incomplete.");
  await prisma.$disconnect();
}
