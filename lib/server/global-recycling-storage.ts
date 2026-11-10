import "server-only";

import { Prisma } from "../../generated/prisma/client.ts";
import { materialConflicts } from "../recycling/global-conciliation.ts";
import { classifyRecyclingTipification, minimumPortabilityDate, normalizeRecyclingTipification, selectRecyclableManagements } from "../recycling/intelligent-recycling.ts";
import { buildCrmRecyclingOutput, CRM_RECYCLING_HEADERS } from "../export/crm-recycling-export.ts";
import { nextBaseCode } from "./base-code.ts";
import { lockCommercialMobiles } from "./commercial-locks.ts";
import { prisma } from "./prisma.ts";

const BASE_PAGE_SIZE = 250;
const MOBILE_PAGE_SIZE = 250;
export const GLOBAL_RECYCLING_RULE_VERSION = "2026-11-08.v3";

export type GlobalRecyclingCriteria = {
  effectiveDate: string;
  recyclableTipifications: readonly string[];
  minimumMonths: number;
  minimumDate: string;
  /** Optional server-validated ORIGINAL-base scope; omitted means global. */
  baseOriginalId?: string;
};

type Decision = "ELEGIBLE" | "EXCLUIDO" | "REVISION" | "BLOQUEADO";
type EvaluationIndicator =
  | "candidatosTipificacion"
  | "ventasConfirmadas"
  | "oposicionesContacto"
  | "reservasActivas"
  | "condicionesComerciales"
  | "permanenciaInsuficiente";

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

async function snapshotOriginalBases(executionId: string, baseOriginalId?: string) {
  let cursor: string | undefined;
  let total = 0;
  do {
    const bases = await prisma.base.findMany({
      where: { tipo: "ORIGINAL", archivadaEn: null, estado: { not: "LISTA_PARA_LIMPIAR" }, cantidadValidos: { gt: 0 }, metadatos: { path: ["completed"], equals: true }, ...(baseOriginalId ? { id: baseOriginalId } : {}) },
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
  if (criteria.baseOriginalId) {
    const selectedBase = await prisma.base.findUnique({ where: { id: criteria.baseOriginalId }, select: { tipo: true, estado: true, cantidadValidos: true, metadatos: true, archivadaEn: true } });
    if (!selectedBase || selectedBase.archivadaEn || !baseIsValid(selectedBase)) throw new Error("La base ORIGINAL seleccionada no está completa y activa.");
  }
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
        criterios: { version: 2, criteria, baseOriginalId: criteria.baseOriginalId ?? null },
        archivos: { create: files.map((file) => ({
          archivoCrmId: file.id, importacionId: file.importacionId, nombreArchivo: file.nombreArchivo,
          metadatos: { version: 1, archivoTipificacionesLegacyId: file.archivoTipificacionesLegacyId, sourceMetadata: file.metadatos },
        })) },
      }, select: { id: true, estado: true },
    });
    const baseCount = await snapshotOriginalBases(created.id, criteria.baseOriginalId);
    await prisma.ejecucionReciclajeGlobal.update({ where: { id: created.id }, data: { resumen: { version: 2, snapshot: "COMPLETO", bases: baseCount, archivos: files.length, baseOriginalId: criteria.baseOriginalId ?? null } } });
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
  records: { id: string; baseId: string; baseCode: string; sourceRow: number; documento: string | null; nombre: string | null; operadorActual: string | null; fechaPortabilidad: Date | null; provenance: string; lots: readonly { id: string; baseId: string; baseOriginalId: string | null; campaign: string; number: number; createdAt: Date; cycleId: string | null }[] }[];
  canonicalRows: { id: string; archivoCrmId: string; hojaOrigen: string; numeroFilaOrigen: number; fechaGestion: Date | null; tipificacionOriginal: string | null; ventaConfirmada: boolean; evidenciaVenta: string | null }[];
  legacyManagements: { id: string; archivoId: string; numeroFilaOrigen: number; fechaGestion: Date | null; tipificacionOriginal: string | null; ventaConfirmada: boolean; evidenciaVenta: string | null; metadatos: unknown }[];
  blocked: boolean;
  reserved: boolean;
  reservationIds: readonly string[];
  criteria: ReturnType<typeof validateCriteria>;
}): { decision: Decision; reason: string; sources: Prisma.InputJsonValue; indicators: EvaluationIndicator[] } {
  const sources = {
    // v2 keeps non-personal comparison evidence, source IDs and management
    // facts. It deliberately avoids copying names/documents into the snapshot.
    version: 3,
    mobile: input.mobile,
    records: input.records.map((record) => ({
      recordId: record.id, baseId: record.baseId, baseCode: record.baseCode, sourceRow: record.sourceRow,
      provenance: record.provenance, operadorActual: record.operadorActual,
      fechaPortabilidad: record.fechaPortabilidad?.toISOString().slice(0, 10) ?? null,
      documentoPresente: Boolean(record.documento), identidadPresente: Boolean(record.nombre),
      lotes: record.lots.map((lot) => ({ loteId: lot.id, baseId: lot.baseId, baseOriginalId: lot.baseOriginalId, campana: lot.campaign, numeroLote: lot.number, fechaDistribucion: lot.createdAt.toISOString(), cicloId: lot.cycleId })),
    })),
    canonicalRows: input.canonicalRows.map((row) => ({ rowId: row.id, archivoCrmId: row.archivoCrmId, hoja: row.hojaOrigen, fila: row.numeroFilaOrigen, fechaGestion: row.fechaGestion?.toISOString().slice(0, 10) ?? null, tipificacion: normalizeRecyclingTipification(row.tipificacionOriginal), ventaConfirmada: row.ventaConfirmada })),
    legacyManagements: input.legacyManagements.map((management) => ({ managementId: management.id, archivoId: management.archivoId, fila: management.numeroFilaOrigen, fechaGestion: management.fechaGestion?.toISOString().slice(0, 10) ?? null, tipificacion: normalizeRecyclingTipification(management.tipificacionOriginal), ventaConfirmada: management.ventaConfirmada, ventaAmbigua: saleAmbiguous(management.metadatos) })),
    activeReservationIds: [...input.reservationIds],
    atribucionDistribucion: (() => {
      const lots = input.records.flatMap((record) => record.lots.map((lot) => ({ ...lot, recordId: record.id })));
      const unique = new Map(lots.map((lot) => [lot.id, lot]));
      return unique.size === 0 ? { estado: "SIN_DISTRIBUCION_HISTORICA", loteIds: [] } : unique.size === 1
        ? { estado: "VERIFICADA", loteIds: [...unique.keys()] }
        : { estado: "AMBIGUA", loteIds: [...unique.keys()] };
    })(),
  } as Prisma.InputJsonValue;
  const managements = [
    ...input.canonicalRows.map((row) => ({ id: row.id, managedAt: row.fechaGestion, tipification: row.tipificacionOriginal, confirmed: row.ventaConfirmada, evidence: row.evidenciaVenta, ambiguous: false })),
    ...input.legacyManagements.map((row) => ({ id: row.id, managedAt: row.fechaGestion, tipification: row.tipificacionOriginal, confirmed: row.ventaConfirmada, evidence: row.evidenciaVenta, ambiguous: saleAmbiguous(row.metadatos) })),
  ];
  const selectedManagements = selectRecyclableManagements(managements, input.criteria.recyclableTipifications);
  const indicators: EvaluationIndicator[] = selectedManagements.length ? ["candidatosTipificacion"] : [];
  if (input.blocked) return { decision: "BLOQUEADO", reason: "Venta confirmada en registro comercial externo", sources, indicators: [...indicators, "ventasConfirmadas"] };
  if (!input.records.length) return { decision: "REVISION", reason: "Sin registro válido en el universo de bases original", sources, indicators: [...indicators, "condicionesComerciales"] };
  if (input.records.every((record) => record.provenance === "MOCK")) return { decision: "REVISION", reason: "Solo existe enriquecimiento MOCK; no es evidencia comercial definitiva", sources, indicators: [...indicators, "condicionesComerciales"] };
  const opposition = managements.find((management) => classifyRecyclingTipification(management.tipification) === "OPOSICION_CONTACTO");
  if (opposition) return { decision: "REVISION", reason: "Oposición al contacto documentada; supresión comercial prioritaria", sources, indicators: [...indicators, "oposicionesContacto"] };
  if (input.reserved) indicators.push("reservasActivas");
  const conflicts = materialConflicts(input.records.map((record) => ({ documento: record.documento, nombre: record.nombre, operadorActual: record.operadorActual, fechaPortabilidad: record.fechaPortabilidad, provenance: record.provenance })));
  if (conflicts.length) return { decision: "REVISION", reason: `Contradicción material: ${conflicts.join(", ")}`, sources, indicators: [...indicators, "condicionesComerciales"] };
  const crmSale = managements.find((management) => management.confirmed || classifyRecyclingTipification(management.tipification) === "VENTA_CRM_NO_CONFIRMADA");
  if (crmSale) return { decision: "REVISION", reason: "Venta indicada en CRM sin confirmación en Ventas", sources, indicators };
  if (managements.some((management) => management.ambiguous)) return { decision: "REVISION", reason: "Dato de venta ambiguo; requiere revisión humana", sources, indicators };
  const dated = managements.flatMap((management) => management.managedAt ? [{ ...management, date: management.managedAt }] : []);
  if (!dated.length) return { decision: "REVISION", reason: "Sin gestión CRM con fecha válida", sources, indicators };
  dated.sort((left, right) => right.date.getTime() - left.date.getTime());
  const newest = dated[0]!;
  // AGENDADO e INTERESADO se conservan como gestiones históricas, pero no
  // invalidan por sí solas una candidatura originada por otra gestión elegida.
  if (classifyRecyclingTipification(newest.tipification) === "RECHAZO_COMERCIAL") return { decision: "EXCLUIDO", reason: "Rechazo comercial posterior; no se recicla automáticamente", sources, indicators };
  if (classifyRecyclingTipification(newest.tipification) === "DATOS_INCORRECTOS") return { decision: "REVISION", reason: "Datos de contacto o titularidad requieren revisión", sources, indicators };
  if (!selectedManagements.length) return { decision: "EXCLUIDO", reason: "Ninguna gestión CRM coincide con las tipificaciones seleccionadas", sources, indicators };
  // Recycling does not select a campaign. A base can only become commercially
  // eligible when it has a trustworthy current operator; campaign-matrix
  // compatibility remains a final distribution-side validation.
  const trustedOperator = input.records.some((record) => record.provenance === "API_REAL" && Boolean(record.operadorActual?.trim()));
  if (!trustedOperator) return { decision: "REVISION", reason: "Operador actual no verificado para elegibilidad comercial", sources, indicators: [...indicators, "condicionesComerciales"] };
  const portability = input.records.find((record) => record.fechaPortabilidad)?.fechaPortabilidad ?? null;
  const effective = day(input.criteria.effectiveDate)!;
  const minimum = day(input.criteria.minimumDate)!;
  if (!portability) return { decision: "REVISION", reason: "Fecha de portabilidad ausente o inválida", sources, indicators: [...indicators, "permanenciaInsuficiente"] };
  if (portability.getTime() < minimum.getTime()) return { decision: "REVISION", reason: "Fecha de portabilidad anterior al mínimo histórico", sources, indicators: [...indicators, "permanenciaInsuficiente"] };
  if (completedMonths(portability, effective) < input.criteria.minimumMonths) return { decision: "REVISION", reason: "No cumple cuatro meses calendario completos de permanencia", sources, indicators: [...indicators, "permanenciaInsuficiente"] };
  return {
    decision: "ELEGIBLE",
    reason: input.reserved
      ? "Tipificación seleccionada; la reserva anterior se transferirá atómicamente al confirmar el nuevo lote"
      : "Tipificación seleccionada, operador verificado y permanencia cumplida",
    sources,
    indicators,
  };
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
  const summary: Record<Decision | "evaluated" | EvaluationIndicator, number> = {
    evaluated: 0, ELEGIBLE: 0, EXCLUIDO: 0, REVISION: 0, BLOQUEADO: 0,
    candidatosTipificacion: 0, ventasConfirmadas: 0, oposicionesContacto: 0,
    reservasActivas: 0, condicionesComerciales: 0, permanenciaInsuficiente: 0,
  };
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
        prisma.reservaComercial.findMany({ where: { movilNormalizado: { in: selected }, estado: "ACTIVA" }, select: { id: true, movilNormalizado: true } }),
        legacyIds.length ? prisma.gestionTipificacion.findMany({ where: { archivoId: { in: legacyIds }, movilNormalizado: { in: selected } }, select: { id: true, archivoId: true, numeroFilaOrigen: true, movilNormalizado: true, fechaGestion: true, tipificacionOriginal: true, ventaConfirmada: true, evidenciaVenta: true, metadatos: true } }) : [],
      ]);
      // The CRM filename never determines origin. These persisted relations are
      // the only evidence used to attach a CRM mobile to prior distribution.
      const lotRelations = records.length ? await prisma.loteRegistro.findMany({
        where: { registroId: { in: records.map((record) => record.id) } },
        select: { registroId: true, lote: { select: { id: true, baseId: true, baseOriginalId: true, campana: true, numeroLote: true, creadoEn: true, base: { select: { metadatos: true } } } } },
      }) : [];
      const group = <T extends { movilNormalizado: string | null }>(items: readonly T[]) => {
        const result = new Map<string, T[]>();
        for (const item of items) if (item.movilNormalizado) result.set(item.movilNormalizado, [...(result.get(item.movilNormalizado) ?? []), item]);
        return result;
      };
      const byRows = group(rows);
      const byRecords = group(records);
      const lotsByRecord = new Map<string, { id: string; baseId: string; baseOriginalId: string | null; campaign: string; number: number; createdAt: Date; cycleId: string | null }[]>();
      for (const relation of lotRelations) {
        const metadata = relation.lote.base.metadatos;
        const cycleId = metadata && typeof metadata === "object" && typeof (metadata as { globalRecyclingExecutionId?: unknown }).globalRecyclingExecutionId === "string"
          ? (metadata as { globalRecyclingExecutionId: string }).globalRecyclingExecutionId
          : null;
        lotsByRecord.set(relation.registroId, [...(lotsByRecord.get(relation.registroId) ?? []), { id: relation.lote.id, baseId: relation.lote.baseId, baseOriginalId: relation.lote.baseOriginalId, campaign: relation.lote.campana, number: relation.lote.numeroLote, createdAt: relation.lote.creadoEn, cycleId }]);
      }
      const byLegacy = group(legacy);
      const sold = new Set(sales.flatMap((row) => row.movilNormalizado ? [row.movilNormalizado] : []));
      const reservationsByMobile = group(reservations);
      const decisions = selected.map((mobile) => {
        const result = decide({
          mobile,
          records: (byRecords.get(mobile) ?? []).map((record) => ({ id: record.id, baseId: record.base.id, baseCode: record.base.codigo, sourceRow: record.numeroFilaOriginal, documento: record.documento, nombre: record.nombre, operadorActual: record.operadorActual, fechaPortabilidad: record.fechaPortabilidad, provenance: provenance(record.datosOriginales), lots: lotsByRecord.get(record.id) ?? [] })),
          canonicalRows: byRows.get(mobile) ?? [], legacyManagements: byLegacy.get(mobile) ?? [], blocked: sold.has(mobile), reserved: (reservationsByMobile.get(mobile) ?? []).length > 0, reservationIds: (reservationsByMobile.get(mobile) ?? []).map((reservation) => reservation.id), criteria,
        });
        summary.evaluated += 1;
        summary[result.decision] += 1;
        for (const indicator of result.indicators) summary[indicator] += 1;
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

type DecisionSource = { version?: unknown; records?: unknown; activeReservationIds?: unknown };

function sourceEvidence(value: unknown): { version: number; records: { recordId: string }[]; activeReservationIds: string[] } | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as DecisionSource;
  if ((candidate.version !== 2 && candidate.version !== 3) || !Array.isArray(candidate.records)) return null;
  const records = candidate.records.flatMap((item) => item && typeof item === "object" && typeof (item as { recordId?: unknown }).recordId === "string"
    ? [{ recordId: (item as { recordId: string }).recordId }]
    : []);
  const activeReservationIds = Array.isArray(candidate.activeReservationIds)
    ? [...new Set(candidate.activeReservationIds.filter((id): id is string => typeof id === "string"))]
    : [];
  return records.length ? { version: 2, records, activeReservationIds } : null;
}

function crmCells(record: { datosOriginales: unknown; movilNormalizado: string | null }, metadata: unknown) {
  const stored = record.datosOriginales && typeof record.datosOriginales === "object" ? record.datosOriginales as { cells?: unknown; enrichedCells?: unknown; mobile?: unknown; contactPhone?: unknown } : {};
  const base = metadata && typeof metadata === "object" ? metadata as { columns?: unknown; enrichmentColumns?: unknown } : {};
  const enrichedColumns = Array.isArray(base.enrichmentColumns) ? base.enrichmentColumns.filter((x): x is string => typeof x === "string") : [];
  const originalColumns = Array.isArray(base.columns) ? base.columns.filter((x): x is string => typeof x === "string") : [];
  const enrichedCells = Array.isArray(stored.enrichedCells) ? stored.enrichedCells.map(String) : [];
  const cells = enrichedColumns.length && enrichedCells.length ? enrichedCells : Array.isArray(stored.cells) ? stored.cells.map(String) : [];
  const columns = enrichedColumns.length && enrichedCells.length ? enrichedColumns : originalColumns;
  const output = buildCrmRecyclingOutput({ columns, rows: [{ sourceRow: 1, cells }] });
  const projected = output.rows[0]?.cells ?? Array.from({ length: CRM_RECYCLING_HEADERS.length }, () => "");
  if (!projected[0]) projected[0] = record.movilNormalizado ?? String(stored.mobile ?? "");
  if (!projected[1]) projected[1] = String(stored.contactPhone ?? "");
  return projected;
}

function generationMetadata(executionId: string, sources: readonly { baseId: string; recordId: string; sourceRow: number }[], transitionReservationCount: number) {
  return {
    version: 1, completed: true, revision: null,
    originalFileName: `RECICLAJE_GLOBAL_${executionId}.xlsx`,
    columns: [...CRM_RECYCLING_HEADERS], columnMapping: { movil: 0, enriched: {} },
    enrichmentColumns: [...CRM_RECYCLING_HEADERS], enrichmentMode: "preserve",
    campaignFilters: { includeUnknown: false }, distribution: { selectedCampaigns: [], batchSize: 100 },
    enrichmentSource: "crm", kind: "RECICLADA", operationalSourceRows: sources.map((source) => source.sourceRow),
    globalRecyclingExecutionId: executionId, globalSources: sources,
    globalTransitionReservationCount: transitionReservationCount,
  };
}

/** Paged administrative listing; it deliberately returns counters, not CRM rows. */
export async function listGlobalRecyclingExecutions(input: { page?: number; limit?: number }) {
  const page = Math.max(0, Math.min(input.page ?? 0, 10_000));
  const limit = Math.max(1, Math.min(input.limit ?? 25, 100));
  const [total, rows] = await Promise.all([
    prisma.ejecucionReciclajeGlobal.count(),
    prisma.ejecucionReciclajeGlobal.findMany({
      orderBy: { creadoEn: "desc" }, skip: page * limit, take: limit,
      select: { id: true, estado: true, versionReglas: true, criterios: true, resumen: true, creadoEn: true, evaluadoEn: true, baseRecicladaId: true, usuario: { select: { username: true } }, _count: { select: { decisiones: true, archivos: true, bases: true, resultadosGeneracion: true } } },
    }),
  ]);
  return { total, page, limit, executions: rows.map((row) => ({ id: row.id, status: row.estado, ruleVersion: row.versionReglas, criteria: row.criterios, summary: row.resumen, createdAt: row.creadoEn.toISOString(), evaluatedAt: row.evaluadoEn?.toISOString() ?? null, recycledBaseId: row.baseRecicladaId, user: row.usuario.username, files: row._count.archivos, bases: row._count.bases, decisions: row._count.decisiones, generationResults: row._count.resultadosGeneracion })) };
}

export async function getGlobalRecyclingExecution(executionId: string, input: { cursor?: string; limit?: number }) {
  const limit = Math.max(1, Math.min(input.limit ?? 50, 100));
  const execution = await prisma.ejecucionReciclajeGlobal.findUnique({
    where: { id: executionId },
    select: { id: true, estado: true, versionReglas: true, criterios: true, resumen: true, creadoEn: true, evaluadoEn: true, baseRecicladaId: true, usuario: { select: { username: true } }, archivos: { select: { id: true, nombreArchivo: true, importacionId: true } }, _count: { select: { bases: true, decisiones: true } } },
  });
  if (!execution) return null;
  const [decisions, reasonGroups] = await Promise.all([
    prisma.decisionEjecucionReciclajeGlobal.findMany({
    where: { ejecucionId: executionId, ...(input.cursor ? { movilNormalizado: { gt: input.cursor } } : {}) }, orderBy: { movilNormalizado: "asc" }, take: limit + 1,
    select: { movilNormalizado: true, decision: true, motivo: true, fuentes: true, creadoEn: true },
    }),
    prisma.decisionEjecucionReciclajeGlobal.groupBy({
      by: ["decision", "motivo"], where: { ejecucionId: executionId }, _count: { _all: true },
    }),
  ]);
  const rows = decisions.slice(0, limit);
  const reasonSummary = reasonGroups.map((group) => ({ decision: group.decision, reason: group.motivo, count: group._count._all })).sort((left, right) => right.count - left.count || left.reason.localeCompare(right.reason, "es"));
  return { id: execution.id, status: execution.estado, ruleVersion: execution.versionReglas, criteria: execution.criterios, summary: execution.resumen, reasonSummary, createdAt: execution.creadoEn.toISOString(), evaluatedAt: execution.evaluadoEn?.toISOString() ?? null, recycledBaseId: execution.baseRecicladaId, user: execution.usuario.username, files: execution.archivos, bases: execution._count.bases, decisions: rows.map((row) => ({ mobileMasked: `${row.movilNormalizado.slice(0, 3)}••••${row.movilNormalizado.slice(-2)}`, decision: row.decision, reason: row.motivo, evidence: row.fuentes, createdAt: row.creadoEn.toISOString() })), nextCursor: decisions.length > limit ? rows.at(-1)?.movilNormalizado ?? null : null };
}

/** Final server-side confirmation. It creates no lots, reservations or sales. */
export async function generateGlobalRecycledBase(input: { executionId: string; userId: string }) {
  try {
    return await prisma.$transaction(async (tx) => {
    const execution = await tx.ejecucionReciclajeGlobal.findUnique({ where: { id: input.executionId }, select: { id: true, estado: true, usuarioId: true, baseRecicladaId: true, fechaEfectiva: true, criterios: true } });
    if (!execution) throw new Error("La ejecución global no existe.");
    if (execution.baseRecicladaId) return { baseId: execution.baseRecicladaId, reused: true, included: 0, excludedChanged: 0 };
    const user = await tx.usuario.findUnique({ where: { id: input.userId }, select: { activo: true } });
    if (!user?.activo) throw new Error("El administrador no está disponible.");
    if (execution.estado === "ERROR") throw new Error("La ejecución tiene un error histórico; crea una nueva ejecución explícita.");
    const claimed = await tx.ejecucionReciclajeGlobal.updateMany({ where: { id: input.executionId, estado: "EVALUADA", baseRecicladaId: null }, data: { estado: "EVALUANDO" } });
    if (claimed.count !== 1) {
      const latest = await tx.ejecucionReciclajeGlobal.findUnique({ where: { id: input.executionId }, select: { baseRecicladaId: true, estado: true } });
      if (latest?.baseRecicladaId) return { baseId: latest.baseRecicladaId, reused: true, included: 0, excludedChanged: 0 };
      throw new Error(latest?.estado === "ERROR" ? "La ejecución tiene un error histórico; crea una nueva ejecución explícita." : "La ejecución global no está lista para generar una base.");
    }
      const decisions = await tx.decisionEjecucionReciclajeGlobal.findMany({ where: { ejecucionId: input.executionId, decision: "ELEGIBLE" }, orderBy: { movilNormalizado: "asc" } });
      if (!decisions.length) {
        await tx.ejecucionReciclajeGlobal.update({ where: { id: input.executionId }, data: { estado: "EVALUADA" } });
        return { baseId: null, reused: false, included: 0, excludedChanged: 0 };
      }
      await lockCommercialMobiles(tx, decisions.map((row) => row.movilNormalizado));
      const mobiles = decisions.map((row) => row.movilNormalizado);
      const [sales, reservations] = await Promise.all([
        tx.ventaExterna.findMany({ where: { movilNormalizado: { in: mobiles }, estado: "CONFIRMADA" }, select: { movilNormalizado: true } }),
        tx.reservaComercial.findMany({ where: { movilNormalizado: { in: mobiles }, estado: "ACTIVA" }, select: { id: true, movilNormalizado: true } }),
      ]);
      const sold = new Set(sales.map((row) => row.movilNormalizado));
      const activeReservationsByMobile = new Map<string, string[]>();
      for (const reservation of reservations) {
        activeReservationsByMobile.set(reservation.movilNormalizado, [...(activeReservationsByMobile.get(reservation.movilNormalizado) ?? []), reservation.id]);
      }
      const sourceIds = decisions.flatMap((decision) => sourceEvidence(decision.fuentes)?.records.map((record) => record.recordId) ?? []);
      const records = await tx.registro.findMany({ where: { id: { in: sourceIds }, tipificacion: "VALIDO", base: { is: { tipo: "ORIGINAL" } } }, select: { id: true, baseId: true, numeroFilaOriginal: true, movilNormalizado: true, documento: true, nombre: true, operadorActual: true, operadorOriginal: true, fechaPortabilidad: true, tipificacion: true, datosOriginales: true, base: { select: { codigo: true, nombreDescriptivo: true, nombreOriginal: true, fechaRecepcion: true, metadatos: true } } } });
      const byMobile = new Map<string, typeof records>();
      for (const record of records) if (record.movilNormalizado) byMobile.set(record.movilNormalizado, [...(byMobile.get(record.movilNormalizado) ?? []), record]);
      const included: typeof records = [];
      const transitionReservationIdsByMobile = new Map<string, string[]>();
      const outcomes: { movilNormalizado: string; estado: "INCLUIDO" | "EXCLUIDO_CAMBIO"; motivo: string; procedencias: Prisma.InputJsonValue }[] = [];
      for (const decision of decisions) {
        const candidates = (byMobile.get(decision.movilNormalizado) ?? []).sort((a, b) => a.base.codigo.localeCompare(b.base.codigo) || a.numeroFilaOriginal - b.numeroFilaOriginal || a.id.localeCompare(b.id));
        const snapshot = sourceEvidence(decision.fuentes);
        const activeReservationIds = activeReservationsByMobile.get(decision.movilNormalizado) ?? [];
        let reason: string | null = sold.has(decision.movilNormalizado) ? "Venta confirmada desde la evaluación" : null;
        if (!reason && !snapshot) reason = "Snapshot RG-3 sin evidencia v2; crea una nueva ejecución";
        if (!reason && activeReservationIds.some((id) => !snapshot!.activeReservationIds.includes(id))) reason = "La reserva activa cambió desde la evaluación; crea una nueva ejecución";
        if (!reason && !candidates.length) reason = "Registro original ya no está disponible";
        if (!reason) {
          const conflicts = materialConflicts(candidates.map((record) => ({ documento: record.documento, nombre: record.nombre, operadorActual: record.operadorActual, fechaPortabilidad: record.fechaPortabilidad, provenance: provenance(record.datosOriginales) })));
          if (conflicts.length) reason = `Contradicción material al confirmar: ${conflicts.join(", ")}`;
          else if (candidates.every((record) => provenance(record.datosOriginales) === "MOCK")) reason = "Solo existe enriquecimiento MOCK; no es evidencia comercial definitiva";
        }
        const sources = candidates.map((record) => ({ baseId: record.baseId, baseCode: record.base.codigo, recordId: record.id, sourceRow: record.numeroFilaOriginal }));
        if (reason) outcomes.push({ movilNormalizado: decision.movilNormalizado, estado: "EXCLUIDO_CAMBIO", motivo: reason, procedencias: { version: 1, sources } });
        else {
          const selected = candidates[0]!;
          included.push(selected);
          transitionReservationIdsByMobile.set(decision.movilNormalizado, activeReservationIds);
          outcomes.push({ movilNormalizado: decision.movilNormalizado, estado: "INCLUIDO", motivo: activeReservationIds.length ? "Revalidado; transición de reserva pendiente de confirmar lote" : "Revalidado al confirmar", procedencias: { version: 1, sources, activeReservationIds } });
        }
      }
      await tx.resultadoGeneracionReciclajeGlobal.createMany({ data: outcomes.map((outcome) => ({ ejecucionId: input.executionId, ...outcome })), skipDuplicates: true });
      if (!included.length) { await tx.ejecucionReciclajeGlobal.update({ where: { id: input.executionId }, data: { estado: "EVALUADA" } }); return { baseId: null, reused: false, included: 0, excludedChanged: outcomes.length }; }
      const sourceSummary = included.map((record) => ({ baseId: record.baseId, recordId: record.id, sourceRow: record.numeroFilaOriginal }));
      const meta = generationMetadata(input.executionId, sourceSummary, new Set([...transitionReservationIdsByMobile.values()].flat()).size);
      const code = await nextBaseCode(tx, execution.fechaEfectiva);
      const base = await tx.base.create({ data: { codigo: code, nombreOriginal: meta.originalFileName, nombreDescriptivo: `Reciclada global · ${execution.fechaEfectiva.toISOString().slice(0, 10)}`, fechaRecepcion: execution.fechaEfectiva, tipo: "RECICLADA", estado: "LISTA_PARA_DISTRIBUIR", cantidadImportados: included.length, cantidadValidos: included.length, cantidadExcluidos: 0, metadatos: meta as unknown as Prisma.InputJsonValue } });
      await tx.registro.createMany({ data: included.map((record, index) => { const cells = crmCells(record, record.base.metadatos); return { baseId: base.id, numeroFilaOriginal: index + 2, movilNormalizado: record.movilNormalizado, documento: record.documento, nombre: record.nombre, operadorActual: record.operadorActual, operadorOriginal: record.operadorOriginal, fechaPortabilidad: record.fechaPortabilidad, tipificacion: record.tipificacion, datosOriginales: { version: 1, cells, mobile: cells[0] ?? "", contactPhone: cells[1] ?? "", reason: null, enrichedCells: cells, provenance: provenance(record.datosOriginales), globalSource: { baseId: record.baseId, baseCode: record.base.codigo, recordId: record.id, sourceRow: record.numeroFilaOriginal }, globalTransition: { executionId: input.executionId, priorReservationIds: transitionReservationIdsByMobile.get(record.movilNormalizado ?? "") ?? [] }, sourceOriginal: record.datosOriginales } as Prisma.InputJsonValue }; }) });
      await tx.ejecucionReciclajeGlobal.update({ where: { id: input.executionId }, data: { baseRecicladaId: base.id, generadoEn: new Date(), estado: "EVALUADA" } });
      await tx.eventoAuditoria.createMany({ data: [{ operacionId: `reciclaje-global:${input.executionId}:base-generada`, accion: "BASE_RECICLADA", usuarioId: input.userId, baseId: base.id, cantidad: included.length, metadatos: { executionId: input.executionId, kind: "GLOBAL", excludedChanged: outcomes.filter((outcome) => outcome.estado === "EXCLUIDO_CAMBIO").length } }], skipDuplicates: true });
      return { baseId: base.id, reused: false, included: included.length, excludedChanged: outcomes.filter((outcome) => outcome.estado === "EXCLUIDO_CAMBIO").length };
    });
  } catch (error) {
    // This update intentionally runs after the failed transaction rolls back,
    // so ERROR is durable and the execution is never silently resumed.
    const latest = await prisma.ejecucionReciclajeGlobal.findUnique({ where: { id: input.executionId }, select: { baseRecicladaId: true, resumen: true } });
    if (latest?.baseRecicladaId) return { baseId: latest.baseRecicladaId, reused: true, included: 0, excludedChanged: 0 };
    const previousSummary = latest?.resumen && typeof latest.resumen === "object" ? latest.resumen as Record<string, unknown> : {};
    await prisma.ejecucionReciclajeGlobal.updateMany({ where: { id: input.executionId, estado: "EVALUANDO", baseRecicladaId: null }, data: { estado: "ERROR", resumen: { ...previousSummary, generation: { status: "ERROR", code: "GENERACION_FALLIDA" } } as Prisma.InputJsonValue } });
    throw error;
  }
}
