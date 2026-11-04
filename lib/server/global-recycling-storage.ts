import "server-only";

import { Prisma } from "../../generated/prisma/client.ts";
import { materialConflicts } from "../recycling/global-conciliation.ts";
import { minimumPortabilityDate, normalizeRecyclingTipification } from "../recycling/intelligent-recycling.ts";
import { prisma } from "./prisma.ts";

const BASE_PAGE_SIZE = 250;
const MOBILE_PAGE_SIZE = 250;
export const GLOBAL_RECYCLING_RULE_VERSION = "2026-11-03.v1";

export type GlobalRecyclingCriteria = {
  effectiveDate: string;
  recyclableTipifications: readonly string[];
  minimumMonths: number;
  minimumDate: string;
};

type Decision = "ELEGIBLE" | "EXCLUIDO" | "REVISION" | "BLOQUEADO";

function day(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value ? null : parsed;
}

function completedMonths(from: Date, to: Date) {
  let months = (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + to.getUTCMonth() - from.getUTCMonth();
  if (to.getUTCDate() < from.getUTCDate()) months -= 1;
  return Math.max(0, months);
}

function provenance(value: unknown): "EXCEL" | "CRM" | "MOCK" | "API_REAL" {
  const raw = value && typeof value === "object" ? (value as { provenance?: unknown }).provenance : null;
  return ["EXCEL", "CRM", "MOCK", "API_REAL"].includes(String(raw)) ? raw as "EXCEL" | "CRM" | "MOCK" | "API_REAL" : "EXCEL";
}

function saleAmbiguous(value: unknown) {
  return Boolean(value && typeof value === "object" && (value as { saleAmbiguous?: unknown }).saleAmbiguous === true);
}

function validateCriteria(criteria: GlobalRecyclingCriteria) {
  if (!day(criteria.effectiveDate) || !day(criteria.minimumDate) || criteria.minimumDate !== minimumPortabilityDate || criteria.minimumMonths !== 4) {
    throw new Error("Los criterios globales de reciclaje no son válidos.");
  }
  const values = [...new Set(criteria.recyclableTipifications.map(normalizeRecyclingTipification).filter(Boolean))];
  if (!values.length) throw new Error("Selecciona al menos una tipificación para la evaluación global.");
  return { ...criteria, recyclableTipifications: values };
}

function baseIsValid(base: { metadatos: unknown; tipo: string; estado: string; cantidadValidos: number }) {
  return base.tipo === "ORIGINAL" && base.estado !== "LISTA_PARA_LIMPIAR" && base.cantidadValidos > 0
    && Boolean(base.metadatos && typeof base.metadatos === "object" && (base.metadatos as { completed?: unknown }).completed === true);
}

async function snapshotOriginalBases(executionId: string) {
  let cursor: string | undefined;
  let total = 0;
  do {
    const bases = await prisma.base.findMany({
      where: { tipo: "ORIGINAL", estado: { not: "LISTA_PARA_LIMPIAR" }, cantidadValidos: { gt: 0 }, metadatos: { path: ["completed"], equals: true } },
      select: { id: true, codigo: true, cantidadImportados: true, cantidadValidos: true, cantidadExcluidos: true, fechaRecepcion: true, estado: true, tipo: true, metadatos: true },
      orderBy: { id: "asc" }, take: BASE_PAGE_SIZE, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (!bases.length) break;
    const valid = bases.filter(baseIsValid);
    await prisma.ejecucionReciclajeGlobalBase.createMany({
      data: valid.map((base) => ({
        ejecucionId: executionId, baseOriginalId: base.id, codigoBase: base.codigo,
        resumen: { version: 1, tipo: base.tipo, estado: base.estado, importados: base.cantidadImportados, validos: base.cantidadValidos, excluidos: base.cantidadExcluidos, fechaRecepcion: base.fechaRecepcion?.toISOString().slice(0, 10) ?? null },
      })),
      skipDuplicates: true,
    });
    total += valid.length;
    cursor = bases.at(-1)?.id;
  } while (cursor);
  return total;
}

export async function createGlobalRecyclingExecution(input: { operationId: string; userId: string; archivoCrmIds: readonly string[]; criteria: GlobalRecyclingCriteria }) {
  const existing = await prisma.ejecucionReciclajeGlobal.findUnique({ where: { operacionId: input.operationId }, select: { id: true, estado: true } });
  if (existing) return { id: existing.id, status: existing.estado, reused: true };
  const criteria = validateCriteria(input.criteria);
  const fileIds = [...new Set(input.archivoCrmIds)];
  if (!fileIds.length || fileIds.length !== input.archivoCrmIds.length) throw new Error("Los archivos CRM seleccionados no son válidos.");
  const [user, files] = await Promise.all([
    prisma.usuario.findUnique({ where: { id: input.userId }, select: { activo: true } }),
    prisma.archivoCrmCanonico.findMany({ where: { id: { in: fileIds } }, select: { id: true, importacionId: true, nombreArchivo: true, metadatos: true, archivoTipificacionesLegacyId: true } }),
  ]);
  if (!user?.activo) throw new Error("El autor de la ejecución no está disponible.");
  if (files.length !== fileIds.length) throw new Error("Uno de los archivos CRM canónicos no existe.");
  try {
    const created = await prisma.ejecucionReciclajeGlobal.create({
      data: {
        operacionId: input.operationId, usuarioId: input.userId, fechaEfectiva: day(criteria.effectiveDate)!, versionReglas: GLOBAL_RECYCLING_RULE_VERSION,
        criterios: { version: 1, criteria },
        archivos: { create: files.map((file) => ({
          archivoCrmId: file.id, importacionId: file.importacionId, nombreArchivo: file.nombreArchivo,
          metadatos: { version: 1, archivoTipificacionesLegacyId: file.archivoTipificacionesLegacyId, sourceMetadata: file.metadatos },
        })) },
      }, select: { id: true, estado: true },
    });
    const baseCount = await snapshotOriginalBases(created.id);
    await prisma.ejecucionReciclajeGlobal.update({ where: { id: created.id }, data: { resumen: { version: 1, snapshot: "COMPLETO", bases: baseCount, archivos: files.length } } });
    return { id: created.id, status: created.estado, reused: false };
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
    const raced = await prisma.ejecucionReciclajeGlobal.findUnique({ where: { operacionId: input.operationId }, select: { id: true, estado: true } });
    if (!raced) throw error;
    return { id: raced.id, status: raced.estado, reused: true };
  }
}

function decide(input: {
  mobile: string;
  records: { id: string; baseId: string; baseCode: string; sourceRow: number; documento: string | null; nombre: string | null; operadorActual: string | null; fechaPortabilidad: Date | null; provenance: string }[];
  canonicalRows: { id: string; archivoCrmId: string; hojaOrigen: string; numeroFilaOrigen: number; fechaGestion: Date | null; tipificacionOriginal: string | null; ventaConfirmada: boolean; evidenciaVenta: string | null }[];
  legacyManagements: { id: string; archivoId: string; numeroFilaOrigen: number; fechaGestion: Date | null; tipificacionOriginal: string | null; ventaConfirmada: boolean; evidenciaVenta: string | null; metadatos: unknown }[];
  blocked: boolean;
  reserved: boolean;
  criteria: ReturnType<typeof validateCriteria>;
}): { decision: Decision; reason: string; sources: Prisma.InputJsonValue } {
  const sources = {
    version: 1,
    mobile: input.mobile,
    records: input.records.map((record) => ({ recordId: record.id, baseId: record.baseId, baseCode: record.baseCode, sourceRow: record.sourceRow, provenance: record.provenance })),
    canonicalRows: input.canonicalRows.map((row) => ({ rowId: row.id, archivoCrmId: row.archivoCrmId, hoja: row.hojaOrigen, fila: row.numeroFilaOrigen })),
    legacyManagements: input.legacyManagements.map((management) => ({ managementId: management.id, archivoId: management.archivoId, fila: management.numeroFilaOrigen })),
  } as Prisma.InputJsonValue;
  if (input.blocked) return { decision: "BLOQUEADO", reason: "Venta confirmada en registro comercial externo", sources };
  if (input.reserved) return { decision: "REVISION", reason: "Reserva comercial activa; requiere liberación explícita", sources };
  const conflicts = materialConflicts(input.records.map((record) => ({ documento: record.documento, nombre: record.nombre, operadorActual: record.operadorActual, fechaPortabilidad: record.fechaPortabilidad, provenance: record.provenance })));
  if (conflicts.length) return { decision: "REVISION", reason: `Contradicción material: ${conflicts.join(", ")}`, sources };
  if (!input.records.length) return { decision: "REVISION", reason: "Sin registro válido en el universo de bases original", sources };
  if (input.records.every((record) => record.provenance === "MOCK")) return { decision: "REVISION", reason: "Solo existe enriquecimiento MOCK; no es evidencia comercial definitiva", sources };
  const managements = [
    ...input.canonicalRows.map((row) => ({ id: row.id, managedAt: row.fechaGestion, tipification: row.tipificacionOriginal, confirmed: row.ventaConfirmada, evidence: row.evidenciaVenta, ambiguous: false })),
    ...input.legacyManagements.map((row) => ({ id: row.id, managedAt: row.fechaGestion, tipification: row.tipificacionOriginal, confirmed: row.ventaConfirmada, evidence: row.evidenciaVenta, ambiguous: saleAmbiguous(row.metadatos) })),
  ];
  const confirmed = managements.find((management) => management.confirmed);
  if (confirmed) return { decision: "BLOQUEADO", reason: confirmed.evidence || "Venta confirmada en gestión CRM", sources };
  if (managements.some((management) => management.ambiguous)) return { decision: "REVISION", reason: "Dato de venta ambiguo; requiere revisión humana", sources };
  const dated = managements.flatMap((management) => management.managedAt ? [{ ...management, date: management.managedAt }] : []);
  if (!dated.length) return { decision: "REVISION", reason: "Sin gestión CRM con fecha válida", sources };
  dated.sort((left, right) => right.date.getTime() - left.date.getTime());
  const newest = dated[0]!;
  const types = new Set(dated.filter((entry) => entry.date.getTime() === newest.date.getTime()).map((entry) => normalizeRecyclingTipification(entry.tipification)));
  if (types.size > 1) return { decision: "REVISION", reason: "Tipificaciones contradictorias en la misma fecha", sources };
  if (!input.criteria.recyclableTipifications.includes(normalizeRecyclingTipification(newest.tipification))) return { decision: "EXCLUIDO", reason: "Tipificación no seleccionada o no reconocida", sources };
  const portability = input.records.find((record) => record.fechaPortabilidad)?.fechaPortabilidad ?? null;
  const effective = day(input.criteria.effectiveDate)!;
  const minimum = day(input.criteria.minimumDate)!;
  if (!portability) return { decision: "REVISION", reason: "Fecha de portabilidad ausente o inválida", sources };
  if (portability.getTime() < minimum.getTime()) return { decision: "REVISION", reason: "Fecha de portabilidad anterior al mínimo histórico", sources };
  if (completedMonths(portability, effective) < input.criteria.minimumMonths) return { decision: "REVISION", reason: "No cumple cuatro meses calendario completos de permanencia", sources };
  return { decision: "ELEGIBLE", reason: "Tipificación seleccionada y permanencia cumplida", sources };
}

export async function evaluateGlobalRecyclingExecution(executionId: string) {
  const execution = await prisma.ejecucionReciclajeGlobal.findUnique({
    where: { id: executionId },
    include: { archivos: { select: { archivoCrmId: true, metadatos: true } } },
  });
  if (!execution) throw new Error("La ejecución global no existe.");
  if (execution.estado === "EVALUADA") return { id: execution.id, status: execution.estado, reused: true, summary: execution.resumen };
  const claimed = await prisma.ejecucionReciclajeGlobal.updateMany({ where: { id: executionId, estado: "PREPARADA" }, data: { estado: "EVALUANDO" } });
  if (claimed.count !== 1) {
    const latest = await prisma.ejecucionReciclajeGlobal.findUnique({ where: { id: executionId }, select: { estado: true, resumen: true } });
    return { id: executionId, status: latest?.estado ?? "ERROR", reused: latest?.estado === "EVALUADA", summary: latest?.resumen ?? null };
  }
  const criteria = validateCriteria((execution.criterios as { criteria?: GlobalRecyclingCriteria }).criteria ?? {} as GlobalRecyclingCriteria);
  const fileIds = execution.archivos.map((file) => file.archivoCrmId);
  const legacyIds = execution.archivos.flatMap((file) => {
    const value = file.metadatos && typeof file.metadatos === "object" ? (file.metadatos as { archivoTipificacionesLegacyId?: unknown }).archivoTipificacionesLegacyId : null;
    return typeof value === "string" ? [value] : [];
  });
  const summary: Record<Decision | "evaluated", number> = { evaluated: 0, ELEGIBLE: 0, EXCLUIDO: 0, REVISION: 0, BLOQUEADO: 0 };
  let cursor: string | null = null;
  try {
    do {
      const mobileRows: { movil_normalizado: string }[] = await prisma.$queryRaw<{ movil_normalizado: string }[]>(Prisma.sql`
        SELECT DISTINCT movil_normalizado FROM filas_archivos_crm
        WHERE archivo_crm_id IN (${Prisma.join(fileIds)})
          AND movil_normalizado IS NOT NULL
          ${cursor ? Prisma.sql`AND movil_normalizado > ${cursor}` : Prisma.empty}
        ORDER BY movil_normalizado ASC LIMIT ${MOBILE_PAGE_SIZE + 1}
      `);
      const selected = mobileRows.slice(0, MOBILE_PAGE_SIZE).map((row) => row.movil_normalizado);
      cursor = mobileRows.length > MOBILE_PAGE_SIZE ? selected.at(-1) ?? null : null;
      if (!selected.length) break;
      const [rows, records, sales, reservations, legacy] = await Promise.all([
        prisma.filaArchivoCrm.findMany({ where: { archivoCrmId: { in: fileIds }, movilNormalizado: { in: selected } }, select: { id: true, archivoCrmId: true, movilNormalizado: true, hojaOrigen: true, numeroFilaOrigen: true, fechaGestion: true, tipificacionOriginal: true, ventaConfirmada: true, evidenciaVenta: true } }),
        prisma.registro.findMany({
          where: {
            movilNormalizado: { in: selected },
            tipificacion: "VALIDO",
            base: { is: { ejecucionesReciclajeGlobal: { some: { ejecucionId: executionId } } } },
          },
          select: {
            id: true, movilNormalizado: true, numeroFilaOriginal: true, documento: true, nombre: true,
            operadorActual: true, fechaPortabilidad: true, datosOriginales: true,
            base: { select: { id: true, codigo: true } },
          },
        }),
        prisma.ventaExterna.findMany({ where: { movilNormalizado: { in: selected }, estado: "CONFIRMADA" }, select: { movilNormalizado: true } }),
        prisma.reservaComercial.findMany({ where: { movilNormalizado: { in: selected }, estado: "ACTIVA" }, select: { movilNormalizado: true } }),
        legacyIds.length ? prisma.gestionTipificacion.findMany({ where: { archivoId: { in: legacyIds }, movilNormalizado: { in: selected } }, select: { id: true, archivoId: true, numeroFilaOrigen: true, movilNormalizado: true, fechaGestion: true, tipificacionOriginal: true, ventaConfirmada: true, evidenciaVenta: true, metadatos: true } }) : [],
      ]);
      const group = <T extends { movilNormalizado: string | null }>(items: readonly T[]) => {
        const result = new Map<string, T[]>();
        for (const item of items) if (item.movilNormalizado) result.set(item.movilNormalizado, [...(result.get(item.movilNormalizado) ?? []), item]);
        return result;
      };
      const byRows = group(rows);
      const byRecords = group(records);
      const byLegacy = group(legacy);
      const sold = new Set(sales.flatMap((row) => row.movilNormalizado ? [row.movilNormalizado] : []));
      const reserved = new Set(reservations.map((row) => row.movilNormalizado));
      const decisions = selected.map((mobile) => {
        const result = decide({
          mobile,
          records: (byRecords.get(mobile) ?? []).map((record) => ({ id: record.id, baseId: record.base.id, baseCode: record.base.codigo, sourceRow: record.numeroFilaOriginal, documento: record.documento, nombre: record.nombre, operadorActual: record.operadorActual, fechaPortabilidad: record.fechaPortabilidad, provenance: provenance(record.datosOriginales) })),
          canonicalRows: byRows.get(mobile) ?? [], legacyManagements: byLegacy.get(mobile) ?? [], blocked: sold.has(mobile), reserved: reserved.has(mobile), criteria,
        });
        summary.evaluated += 1;
        summary[result.decision] += 1;
        return { ejecucionId: executionId, movilNormalizado: mobile, decision: result.decision, motivo: result.reason, fuentes: result.sources };
      });
      await prisma.decisionEjecucionReciclajeGlobal.createMany({ data: decisions, skipDuplicates: true });
    } while (cursor);
    const frozenSummary = { version: 1, ...summary };
    await prisma.ejecucionReciclajeGlobal.update({ where: { id: executionId }, data: { estado: "EVALUADA", resumen: frozenSummary, evaluadoEn: new Date() } });
    return { id: executionId, status: "EVALUADA" as const, reused: false, summary: frozenSummary };
  } catch (error) {
    await prisma.ejecucionReciclajeGlobal.updateMany({ where: { id: executionId, estado: "EVALUANDO" }, data: { estado: "ERROR" } });
    throw error;
  }
}
