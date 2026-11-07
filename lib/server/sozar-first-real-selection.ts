import "server-only";

import { normalizeColumnName } from "../excel/import-excel.ts";
import { prisma } from "./prisma.ts";

type Provenance = "EXCEL" | "CRM" | "MOCK" | "API_REAL";

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function provenance(value: unknown): Provenance {
  const candidate = asRecord(value).provenance;
  return ["EXCEL", "CRM", "MOCK", "API_REAL"].includes(String(candidate))
    ? candidate as Provenance
    : "EXCEL";
}

function isCompleted(value: unknown) {
  return asRecord(value).completed === true;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function crmField(row: { datosOriginales: unknown; archivoCrm: { metadatos: unknown } }, aliases: readonly string[]) {
  const headers = asRecord(row.archivoCrm.metadatos).headers;
  const cells = asRecord(row.datosOriginales).cells;
  if (!Array.isArray(headers) || !Array.isArray(cells)) return null;
  const index = headers.findIndex((header) => aliases.includes(normalizeColumnName(String(header))));
  return index >= 0 ? stringValue(cells[index]) : null;
}

function coherentValue(values: readonly (string | null)[]) {
  const unique = [...new Set(values.filter((value): value is string => Boolean(value)))];
  return { value: unique.length === 1 ? unique[0]! : null, conflict: unique.length > 1 };
}

export type FirstRealSozarCandidateHint = { sourceRow: number; hasCrmHistory: boolean };

export type FirstRealSozarSelectionContext = {
  sourceRow: number;
  provenance: Provenance;
  baseValues: { operadorActual: string | null; operadorOriginal: string | null; fechaPortabilidad: string | null };
  crm: {
    operatorActual: string | null;
    operatorOriginal: string | null;
    portabilityDate: string | null;
    lastManagementDate: string | null;
    managementCount: number;
    hasConflicts: boolean;
  };
};

async function originalBase(baseId: string) {
  const base = await prisma.base.findUnique({
    where: { id: baseId },
    select: { id: true, tipo: true, archivadaEn: true, metadatos: true },
  });
  if (!base || base.tipo !== "ORIGINAL" || base.archivadaEn || !isCompleted(base.metadatos)) {
    throw new Error("La prueba única requiere una base ORIGINAL guardada y completa.");
  }
  return base;
}

async function crmMobilesForBase(baseId: string, mobiles: readonly string[]) {
  if (!mobiles.length) return new Set<string>();
  const [legacy, canonical] = await Promise.all([
    prisma.gestionTipificacion.findMany({
      where: { baseOriginalId: baseId, movilNormalizado: { in: [...mobiles] } },
      distinct: ["movilNormalizado"],
      select: { movilNormalizado: true },
    }),
    prisma.filaArchivoCrm.findMany({
      where: { movilNormalizado: { in: [...mobiles] }, archivoCrm: { asociaciones: { some: { baseOriginalId: baseId } } } },
      distinct: ["movilNormalizado"],
      select: { movilNormalizado: true },
    }),
  ]);
  return new Set([...legacy, ...canonical].flatMap((row) => row.movilNormalizado ? [row.movilNormalizado] : []));
}

/** Metadata only: no mobile, document or CRM row values leave this server helper. */
export async function getFirstRealSozarCandidateHints(baseId: string): Promise<FirstRealSozarCandidateHint[]> {
  await originalBase(baseId);
  const records = await prisma.registro.findMany({
    where: { baseId, movilNormalizado: { not: null }, tipificacion: "VALIDO" },
    select: { numeroFilaOriginal: true, movilNormalizado: true, datosOriginales: true },
    orderBy: { numeroFilaOriginal: "asc" },
  });
  const candidates = records.filter((record) => provenance(record.datosOriginales) !== "API_REAL");
  const crmMobiles = await crmMobilesForBase(baseId, candidates.flatMap((record) => record.movilNormalizado ? [record.movilNormalizado] : []));
  return candidates.map((record) => ({ sourceRow: record.numeroFilaOriginal, hasCrmHistory: Boolean(record.movilNormalizado && crmMobiles.has(record.movilNormalizado)) }))
    .sort((left, right) => Number(right.hasCrmHistory) - Number(left.hasCrmHistory) || left.sourceRow - right.sourceRow);
}

/**
 * Returns a comparison that is safe to render before an authorized request.
 * CRM values are reported only when consistent; MOCK remains labeled as MOCK.
 */
export async function getFirstRealSozarSelectionContext(baseId: string, sourceRow: number): Promise<FirstRealSozarSelectionContext> {
  await originalBase(baseId);
  const record = await prisma.registro.findFirst({
    where: { baseId, numeroFilaOriginal: sourceRow, movilNormalizado: { not: null }, tipificacion: "VALIDO" },
    select: { numeroFilaOriginal: true, movilNormalizado: true, operadorActual: true, operadorOriginal: true, fechaPortabilidad: true, datosOriginales: true },
  });
  if (!record?.movilNormalizado) throw new Error("El móvil seleccionado no pertenece a una fila válida de la base ORIGINAL.");
  const recordProvenance = provenance(record.datosOriginales);
  if (recordProvenance === "API_REAL") throw new Error("El móvil seleccionado ya tiene enriquecimiento API_REAL.");

  const [legacy, canonical] = await Promise.all([
    prisma.gestionTipificacion.findMany({
      where: { baseOriginalId: baseId, movilNormalizado: record.movilNormalizado },
      select: { fechaGestion: true },
    }),
    prisma.filaArchivoCrm.findMany({
      where: { movilNormalizado: record.movilNormalizado, archivoCrm: { asociaciones: { some: { baseOriginalId: baseId } } } },
      select: { fechaGestion: true, datosOriginales: true, archivoCrm: { select: { metadatos: true } } },
    }),
  ]);
  const dates = [...legacy.map((row) => row.fechaGestion), ...canonical.map((row) => row.fechaGestion)]
    .filter((value): value is Date => value instanceof Date)
    .sort((left, right) => right.getTime() - left.getTime());
  const actual = coherentValue(canonical.map((row) => crmField(row, ["operadoractual"])));
  const original = coherentValue(canonical.map((row) => crmField(row, ["operadororiginal", "operadoranterior"])));
  const portability = coherentValue(canonical.map((row) => crmField(row, ["fechaportabilidad"])));
  return {
    sourceRow: record.numeroFilaOriginal,
    provenance: recordProvenance,
    baseValues: {
      operadorActual: record.operadorActual,
      operadorOriginal: record.operadorOriginal,
      fechaPortabilidad: record.fechaPortabilidad?.toISOString().slice(0, 10) ?? null,
    },
    crm: {
      operatorActual: actual.value,
      operatorOriginal: original.value,
      portabilityDate: portability.value,
      lastManagementDate: dates[0]?.toISOString().slice(0, 10) ?? null,
      managementCount: legacy.length + canonical.length,
      hasConflicts: actual.conflict || original.conflict || portability.conflict,
    },
  };
}

/** Used by the executor so the browser cannot select a recycled, archived or real-enriched record. */
export async function getFirstRealSozarEligibleRecord(baseId: string, sourceRow: number) {
  const context = await getFirstRealSozarSelectionContext(baseId, sourceRow);
  const record = await prisma.registro.findFirst({
    where: { baseId, numeroFilaOriginal: context.sourceRow, movilNormalizado: { not: null }, tipificacion: "VALIDO" },
    select: { id: true, movilNormalizado: true },
  });
  if (!record?.movilNormalizado) throw new Error("El móvil seleccionado no contiene un móvil válido.");
  return { id: record.id, movilNormalizado: record.movilNormalizado };
}
