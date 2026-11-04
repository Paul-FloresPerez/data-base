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

const { conciliateCanonicalCrmFile, previewGlobalCrmConciliation, resolveCanonicalOrLegacyCrmFile } = await import("../lib/server/global-crm-conciliation-storage.ts");
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: testUrl }) });
const testRunId = randomUUID();
const baseAId = randomUUID();
const baseBId = randomUUID();
const legacyFileId = randomUUID();
const canonicalFileId = randomUUID();
const legacyImportId = `synthetic-rg2-legacy-${testRunId}`;
const canonicalImportId = `synthetic-rg2-canonical-${testRunId}`;
const metadata = { synthetic: true, testRunId, completed: true };

function base(id: string, label: string) {
  return {
    id, codigo: `RG2-${id.slice(0, 8)}`, nombreOriginal: `synthetic-${label}-${testRunId}.xlsx`, nombreDescriptivo: `RG2 ${label}`,
    estado: "LISTA_PARA_DISTRIBUIR" as const, cantidadImportados: 2, cantidadValidos: 2, cantidadExcluidos: 0, metadatos: metadata,
  };
}

function record(sourceRow: number, mobile: string, document: string, name: string, operator: string, portability: string, provenance: "EXCEL" | "API_REAL" | "MOCK") {
  return {
    numeroFilaOriginal: sourceRow, movilNormalizado: mobile, documento: document, nombre: name, operadorActual: operator,
    fechaPortabilidad: new Date(`${portability}T00:00:00.000Z`), tipificacion: "VALIDO" as const,
    datosOriginales: { ...metadata, provenance },
  };
}

try {
  const identity = await prisma.$queryRaw<{ branch_id: string | null }[]>(Prisma.sql`SELECT current_setting('neon.branch_id', true) AS branch_id`);
  if (identity[0]?.branch_id !== expectedBranchId) throw new Error("Test branch identity mismatch.");
  await prisma.base.create({ data: { ...base(baseAId, "a"), registros: { create: [
    record(2, "612000001", "DOC-COMPATIBLE", "Ana Pérez", "Vodafone", "2026-01-02", "API_REAL"),
    record(3, "612000002", "DOC-A", "Ana Pérez", "Vodafone", "2026-01-02", "API_REAL"),
  ] } } });
  await prisma.base.create({ data: { ...base(baseBId, "b"), cantidadImportados: 3, cantidadValidos: 3, registros: { create: [
    record(2, "612000001", "DOC-COMPATIBLE", "ANA PEREZ", "vodafone", "2026-01-02", "EXCEL"),
    record(3, "612000002", "DOC-B", "Otra Persona", "Orange", "2026-02-02", "EXCEL"),
    record(4, "612000003", "DOC-ONLY-B", "Luis", "Movistar", "2026-03-02", "MOCK"),
  ] } } });
  await prisma.archivoTipificaciones.create({ data: { id: legacyFileId, importacionId: legacyImportId, baseId: baseAId, nombreArchivo: `synthetic-legacy-${testRunId}.xlsx`, resumen: metadata } });
  const legacyManagement = await prisma.gestionTipificacion.create({ data: {
    archivoId: legacyFileId, baseOriginalId: baseAId, numeroFilaOrigen: 2, movilNormalizado: "612000001", tipificacionOriginal: "NO RESPONDE", metadatos: metadata,
  } });
  await prisma.archivoCrmCanonico.create({ data: {
    id: canonicalFileId, importacionId: canonicalImportId, huellaContenido: `rg2-${testRunId.replaceAll("-", "")}`,
    nombreArchivo: `synthetic-global-${testRunId}.xlsx`, archivoTipificacionesLegacyId: legacyFileId, metadatos: metadata,
    filas: { create: [
      { hojaOrigen: "Datos", numeroFilaOrigen: 2, movilNormalizado: "612000001", datosOriginales: metadata, metadatos: metadata },
      { hojaOrigen: "Datos", numeroFilaOrigen: 3, movilNormalizado: "612000001", datosOriginales: metadata, metadatos: metadata },
      { hojaOrigen: "Datos", numeroFilaOrigen: 4, movilNormalizado: "612000002", datosOriginales: metadata, metadatos: metadata },
      { hojaOrigen: "Datos", numeroFilaOrigen: 5, movilNormalizado: "612000003", datosOriginales: metadata, metadatos: metadata },
      { hojaOrigen: "Datos", numeroFilaOrigen: 6, movilNormalizado: "612000004", datosOriginales: metadata, metadatos: metadata },
      { hojaOrigen: "Datos", numeroFilaOrigen: 7, movilNormalizado: null, datosOriginales: metadata, metadatos: metadata },
    ] },
  } });

  const first = await conciliateCanonicalCrmFile({ archivoCrmId: canonicalFileId, pageSize: 1 });
  if (first.pages !== 4 || first.logicalMobiles !== 4 || first.unmatched !== 1 || first.contradictions !== 1 || first.associatedBases !== 2) {
    throw new Error("Global reconciliation summary is inconsistent.");
  }
  const pages = [];
  let cursor: string | null = null;
  do {
    const page = await previewGlobalCrmConciliation({ archivoCrmId: canonicalFileId, cursor, pageSize: 1 });
    pages.push(page);
    cursor = page.cursorSiguiente;
  } while (cursor);
  const logical = pages.flatMap((page) => page.moviles);
  const compatible = logical.find((mobile) => mobile.estado === "COINCIDENCIA_COMPATIBLE" && mobile.coincidencias.length === 2);
  const conflict = logical.find((mobile) => mobile.estado === "REVISION_CONTRADICCION");
  const missing = logical.find((mobile) => mobile.estado === "SIN_COINCIDENCIAS");
  if (!compatible || compatible.filasArchivo.length !== 2 || !conflict || conflict.conflictos.length !== 4 || !missing || pages[0]?.resumen.filasInvalidas !== 1) {
    throw new Error("Logical mobile grouping or material conflict detection failed.");
  }
  const second = await conciliateCanonicalCrmFile({ archivoCrmId: canonicalFileId, pageSize: 2 });
  const [associations, canonicalRows, legacyStillPresent, legacyResolution] = await Promise.all([
    prisma.archivoCrmBase.count({ where: { archivoCrmId: canonicalFileId } }),
    prisma.filaArchivoCrm.count({ where: { archivoCrmId: canonicalFileId } }),
    prisma.gestionTipificacion.count({ where: { id: legacyManagement.id } }),
    resolveCanonicalOrLegacyCrmFile(legacyImportId),
  ]);
  if (second.associatedBases !== 2 || associations !== 2 || canonicalRows !== 6 || legacyStillPresent !== 1 || legacyResolution?.kind !== "CANONICO_LEGACY") {
    throw new Error("Reimport or legacy compatibility changed historical data.");
  }
  console.log(JSON.stringify({ target: "test", testRunId, pages: first.pages, logicalMobiles: first.logicalMobiles, associations, compatibleDuplicatesConsolidated: true, materialConflictReviewed: true, missingRetained: true, legacyPreserved: true, fixturesCleaned: true }));
} finally {
  await prisma.archivoCrmBase.deleteMany({ where: { archivoCrmId: canonicalFileId } });
  await prisma.filaArchivoCrm.deleteMany({ where: { archivoCrmId: canonicalFileId } });
  await prisma.archivoCrmCanonico.deleteMany({ where: { id: canonicalFileId } });
  await prisma.gestionTipificacion.deleteMany({ where: { archivoId: legacyFileId } });
  await prisma.archivoTipificaciones.deleteMany({ where: { id: legacyFileId } });
  await prisma.base.deleteMany({ where: { id: { in: [baseAId, baseBId] } } });
  const [files, bases] = await Promise.all([
    prisma.archivoCrmCanonico.count({ where: { id: canonicalFileId } }),
    prisma.base.count({ where: { id: { in: [baseAId, baseBId] } } }),
  ]);
  if (files || bases) throw new Error("Global conciliation fixture cleanup was incomplete.");
  await prisma.$disconnect();
}
