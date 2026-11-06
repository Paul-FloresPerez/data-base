import "server-only";

import { Prisma } from "../../generated/prisma/client.ts";
import { materialConflicts, type MaterialConflictField } from "../recycling/global-conciliation.ts";
import { normalizeSpanishMobile } from "../excel/cleaning.ts";
import { normalizeRecyclingTipification } from "../recycling/intelligent-recycling.ts";
import { prisma } from "./prisma.ts";

const DEFAULT_PAGE_SIZE = 250;
const MAX_PAGE_SIZE = 1_000;

export type CanonicalCrmRowInput = {
  hoja: string;
  fila: number;
  movil: string;
  fechaGestion: string | null;
  tipificacion: string | null;
  ventaConfirmada: boolean;
  evidenciaVenta: string | null;
  cells: string[];
};

function dateOnly(value: string | null): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Server boundary for the browser-parsed CRM file. The binary never reaches Neon. */
export async function createCanonicalCrmFile(input: { importacionId: string; huellaContenido: string; nombreArchivo: string; headers: string[]; procedencia?: { zipName: string | null; internalPath: string | null } | null }) {
  const existing = await prisma.archivoCrmCanonico.findFirst({ where: { OR: [{ importacionId: input.importacionId }, { huellaContenido: input.huellaContenido }] }, select: { id: true, importacionId: true } });
  if (existing) return { id: existing.id, importacionId: existing.importacionId, reused: true };
  try {
    const file = await prisma.archivoCrmCanonico.create({ data: { importacionId: input.importacionId, huellaContenido: input.huellaContenido, nombreArchivo: input.nombreArchivo, metadatos: { version: 2, headers: input.headers, origin: "CRM", source: input.procedencia ?? { zipName: null, internalPath: null } } }, select: { id: true, importacionId: true } });
    return { ...file, reused: false };
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
    const raced = await prisma.archivoCrmCanonico.findFirstOrThrow({ where: { OR: [{ importacionId: input.importacionId }, { huellaContenido: input.huellaContenido }] }, select: { id: true, importacionId: true } });
    return { ...raced, reused: true };
  }
}

export async function appendCanonicalCrmRows(input: { archivoCrmId: string; rows: readonly CanonicalCrmRowInput[] }) {
  const unique = new Map<string, CanonicalCrmRowInput>();
  for (const row of input.rows) unique.set(`${row.hoja}\u0000${row.fila}`, row);
  const rows = [...unique.values()];
  const file = await prisma.archivoCrmCanonico.findUnique({ where: { id: input.archivoCrmId }, select: { id: true } });
  if (!file) throw new Error("El archivo CRM canónico no existe.");
  await prisma.filaArchivoCrm.createMany({ data: rows.map((row) => ({
    archivoCrmId: input.archivoCrmId, hojaOrigen: row.hoja, numeroFilaOrigen: row.fila,
    movilNormalizado: normalizeSpanishMobile(row.movil), fechaGestion: dateOnly(row.fechaGestion),
    tipificacionOriginal: row.tipificacion?.trim() || null, tipificacionNormalizada: normalizeRecyclingTipification(row.tipificacion),
    ventaConfirmada: row.ventaConfirmada, evidenciaVenta: row.evidenciaVenta?.trim() || null,
    datosOriginales: { version: 1, cells: row.cells }, metadatos: { version: 1, origin: "CRM" },
  })), skipDuplicates: true });
  const [totalRows, validMobiles, invalidRows] = await Promise.all([
    prisma.filaArchivoCrm.count({ where: { archivoCrmId: input.archivoCrmId } }),
    prisma.filaArchivoCrm.findMany({ where: { archivoCrmId: input.archivoCrmId, movilNormalizado: { not: null } }, distinct: ["movilNormalizado"], select: { movilNormalizado: true } }),
    prisma.filaArchivoCrm.count({ where: { archivoCrmId: input.archivoCrmId, movilNormalizado: null } }),
  ]);
  return { totalRows, validMobiles: validMobiles.length, invalidRows };
}

export type GlobalConciliationStatus = "SIN_COINCIDENCIAS" | "COINCIDENCIA_COMPATIBLE" | "REVISION_CONTRADICCION";

export type GlobalConciliationMatch = {
  baseId: string;
  baseCode: string;
  registroId: string;
  sourceRow: number;
  provenance: "EXCEL" | "CRM" | "MOCK" | "API_REAL";
};

export type GlobalConciliationMobile = {
  movilNormalizado: string;
  filasArchivo: { id: string; hojaOrigen: string; numeroFilaOrigen: number }[];
  coincidencias: GlobalConciliationMatch[];
  estado: GlobalConciliationStatus;
  conflictos: MaterialConflictField[];
};

export type GlobalConciliationPage = {
  archivoCrmId: string;
  legacy: { archivoTipificacionesId: string; importacionId: string } | null;
  cursorSiguiente: string | null;
  resumen: { filasInvalidas: number; movilesLogicos: number; encontrados: number; sinCoincidencias: number; enRevision: number };
  moviles: GlobalConciliationMobile[];
};

function metadataCompleted(value: unknown): boolean {
  return Boolean(value && typeof value === "object" && (value as { completed?: unknown }).completed === true);
}

function storedProvenance(value: unknown): GlobalConciliationMatch["provenance"] {
  const provenance = value && typeof value === "object" ? (value as { provenance?: unknown }).provenance : null;
  return ["EXCEL", "CRM", "MOCK", "API_REAL"].includes(String(provenance))
    ? provenance as GlobalConciliationMatch["provenance"]
    : "EXCEL";
}

function pageSize(value: number | undefined) {
  if (value === undefined) return DEFAULT_PAGE_SIZE;
  if (!Number.isInteger(value) || value < 1 || value > MAX_PAGE_SIZE) throw new Error("El tamaño de página no es válido.");
  return value;
}

/**
 * Reads logical mobiles, rather than source rows. The cursor is the normalized
 * mobile so every duplicate source row is returned together, once per page.
 */
export async function previewGlobalCrmConciliation(input: { archivoCrmId: string; cursor?: string | null; pageSize?: number }): Promise<GlobalConciliationPage> {
  const take = pageSize(input.pageSize);
  if (input.cursor && !/^[67]\d{8}$/.test(input.cursor)) throw new Error("El cursor de conciliación no es válido.");
  const file = await prisma.archivoCrmCanonico.findUnique({
    where: { id: input.archivoCrmId },
    select: { id: true, archivoTipificacionesLegacy: { select: { id: true, importacionId: true } } },
  });
  if (!file) throw new Error("El archivo CRM canónico no existe.");

  const mobileRows = await prisma.$queryRaw<{ movil_normalizado: string }[]>(Prisma.sql`
    SELECT DISTINCT movil_normalizado
    FROM filas_archivos_crm
    WHERE archivo_crm_id = ${input.archivoCrmId}::uuid
      AND movil_normalizado IS NOT NULL
      ${input.cursor ? Prisma.sql`AND movil_normalizado > ${input.cursor}` : Prisma.empty}
    ORDER BY movil_normalizado ASC
    LIMIT ${take + 1}
  `);
  const hasMore = mobileRows.length > take;
  const selectedMobiles = mobileRows.slice(0, take).map((row) => row.movil_normalizado);
  const [invalidRows, sourceRows, records] = await Promise.all([
    prisma.filaArchivoCrm.count({ where: { archivoCrmId: input.archivoCrmId, movilNormalizado: null } }),
    selectedMobiles.length ? prisma.filaArchivoCrm.findMany({
      where: { archivoCrmId: input.archivoCrmId, movilNormalizado: { in: selectedMobiles } },
      select: { id: true, movilNormalizado: true, hojaOrigen: true, numeroFilaOrigen: true },
      orderBy: [{ movilNormalizado: "asc" }, { hojaOrigen: "asc" }, { numeroFilaOrigen: "asc" }],
    }) : [],
    selectedMobiles.length ? prisma.registro.findMany({
      where: {
        movilNormalizado: { in: selectedMobiles },
        tipificacion: "VALIDO",
        base: { is: {
          tipo: "ORIGINAL",
          archivadaEn: null,
          estado: { not: "LISTA_PARA_LIMPIAR" },
          cantidadValidos: { gt: 0 },
          metadatos: { path: ["completed"], equals: true },
        } },
      },
      select: {
        id: true, movilNormalizado: true, numeroFilaOriginal: true,
        documento: true, nombre: true, operadorActual: true, fechaPortabilidad: true, datosOriginales: true,
        base: { select: { id: true, codigo: true, metadatos: true } },
      },
      orderBy: [{ movilNormalizado: "asc" }, { baseId: "asc" }, { numeroFilaOriginal: "asc" }],
    }) : [],
  ]);

  const sourceByMobile = new Map<string, GlobalConciliationMobile["filasArchivo"]>();
  for (const row of sourceRows) {
    if (!row.movilNormalizado) continue;
    const current = sourceByMobile.get(row.movilNormalizado) ?? [];
    current.push({ id: row.id, hojaOrigen: row.hojaOrigen, numeroFilaOrigen: row.numeroFilaOrigen });
    sourceByMobile.set(row.movilNormalizado, current);
  }
  const recordsByMobile = new Map<string, typeof records>();
  for (const record of records) {
    if (!record.movilNormalizado || !metadataCompleted(record.base.metadatos)) continue;
    const current = recordsByMobile.get(record.movilNormalizado) ?? [];
    current.push(record);
    recordsByMobile.set(record.movilNormalizado, current);
  }
  const moviles = selectedMobiles.map((movilNormalizado) => {
    const matches = recordsByMobile.get(movilNormalizado) ?? [];
    const conflicts = materialConflicts(matches.map((record) => ({
      documento: record.documento,
      nombre: record.nombre,
      operadorActual: record.operadorActual,
      fechaPortabilidad: record.fechaPortabilidad,
      provenance: storedProvenance(record.datosOriginales),
    })));
    const estado: GlobalConciliationStatus = matches.length === 0
      ? "SIN_COINCIDENCIAS"
      : conflicts.length ? "REVISION_CONTRADICCION" : "COINCIDENCIA_COMPATIBLE";
    return {
      movilNormalizado,
      filasArchivo: sourceByMobile.get(movilNormalizado) ?? [],
      coincidencias: matches.map((record) => ({
        baseId: record.base.id,
        baseCode: record.base.codigo,
        registroId: record.id,
        sourceRow: record.numeroFilaOriginal,
        provenance: storedProvenance(record.datosOriginales),
      })),
      estado,
      conflictos: conflicts,
    };
  });

  return {
    archivoCrmId: file.id,
    legacy: file.archivoTipificacionesLegacy ? { archivoTipificacionesId: file.archivoTipificacionesLegacy.id, importacionId: file.archivoTipificacionesLegacy.importacionId } : null,
    cursorSiguiente: hasMore ? selectedMobiles.at(-1) ?? null : null,
    resumen: {
      filasInvalidas: invalidRows,
      movilesLogicos: moviles.length,
      encontrados: moviles.filter((mobile) => mobile.coincidencias.length > 0).length,
      sinCoincidencias: moviles.filter((mobile) => mobile.estado === "SIN_COINCIDENCIAS").length,
      enRevision: moviles.filter((mobile) => mobile.estado === "REVISION_CONTRADICCION").length,
    },
    moviles,
  };
}

/**
 * Scans in bounded pages and stores one reconciliation result per Base ORIGINAL.
 * It never creates GestionTipificacion rows or changes any legacy association.
 */
export async function conciliateCanonicalCrmFile(input: { archivoCrmId: string; pageSize?: number }) {
  const perBase = new Map<string, { baseId: string; matchedMobiles: number; contradictoryMobiles: number }>();
  let cursor: string | null = null;
  let pages = 0;
  let logicalMobiles = 0;
  let unmatched = 0;
  let contradictions = 0;
  do {
    const page = await previewGlobalCrmConciliation({ archivoCrmId: input.archivoCrmId, cursor, pageSize: input.pageSize });
    pages += 1;
    logicalMobiles += page.resumen.movilesLogicos;
    unmatched += page.resumen.sinCoincidencias;
    contradictions += page.resumen.enRevision;
    for (const mobile of page.moviles) {
      for (const baseId of new Set(mobile.coincidencias.map((match) => match.baseId))) {
        const current = perBase.get(baseId) ?? { baseId, matchedMobiles: 0, contradictoryMobiles: 0 };
        current.matchedMobiles += 1;
        if (mobile.estado === "REVISION_CONTRADICCION") current.contradictoryMobiles += 1;
        perBase.set(baseId, current);
      }
    }
    cursor = page.cursorSiguiente;
  } while (cursor);

  await prisma.$transaction(async (tx) => {
    for (const item of perBase.values()) {
      const existing = await tx.archivoCrmBase.findUnique({
        where: { archivoCrmId_baseOriginalId: { archivoCrmId: input.archivoCrmId, baseOriginalId: item.baseId } },
        select: { metadatos: true },
      });
      const priorMetadata = existing?.metadatos && typeof existing.metadatos === "object" ? existing.metadatos as object : {};
      await tx.archivoCrmBase.upsert({
        where: { archivoCrmId_baseOriginalId: { archivoCrmId: input.archivoCrmId, baseOriginalId: item.baseId } },
        create: {
          archivoCrmId: input.archivoCrmId,
          baseOriginalId: item.baseId,
          resumenConciliacion: { version: 1, scope: "RG2_GLOBAL", ...item },
          metadatos: { ...priorMetadata, globalConciliation: { version: 1, status: "COMPLETADA" } },
        },
        update: {
          resumenConciliacion: { version: 1, scope: "RG2_GLOBAL", ...item },
          metadatos: { ...priorMetadata, globalConciliation: { version: 1, status: "COMPLETADA" } },
        },
      });
    }
  });
  return { pages, logicalMobiles, found: logicalMobiles - unmatched, unmatched, contradictions, associatedBases: perBase.size };
}

/** Read-only compatibility resolver; RG-2 never copies or changes unlinked legacy files. */
export async function resolveCanonicalOrLegacyCrmFile(importacionId: string) {
  const canonical = await prisma.archivoCrmCanonico.findUnique({ where: { importacionId }, select: { id: true, importacionId: true, archivoTipificacionesLegacyId: true } });
  if (canonical) return { kind: "CANONICO" as const, canonical };
  const legacy = await prisma.archivoTipificaciones.findUnique({
    where: { importacionId },
    select: { id: true, importacionId: true, baseId: true, archivoCanonico: { select: { id: true } } },
  });
  if (!legacy) return null;
  return legacy.archivoCanonico
    ? { kind: "CANONICO_LEGACY" as const, canonical: { id: legacy.archivoCanonico.id, importacionId: legacy.importacionId, archivoTipificacionesLegacyId: legacy.id } }
    : { kind: "LEGACY_SIN_MIGRAR" as const, legacy: { id: legacy.id, importacionId: legacy.importacionId, baseId: legacy.baseId } };
}
