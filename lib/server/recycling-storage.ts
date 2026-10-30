import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { normalizeSpanishMobile } from "@/lib/excel/cleaning";
import { portabilityDateForStorage } from "@/lib/excel/portability-date";
import { evaluateIntelligentRecycling, minimumPortabilityDate, normalizeRecyclingTipification, type RecyclingCriteria } from "@/lib/recycling/intelligent-recycling";
import { prisma } from "@/lib/server/prisma";

type FileInput = { importId: string; name: string };
export type ManagementInput = {
  importId: string;
  sourceRow: number;
  mobile: string;
  managedAt: string | null;
  tipification: string | null;
  confirmedSale: boolean;
  saleAmbiguous: boolean;
  saleEvidence: string | null;
  fileName: string;
  sheetName: string;
  zipName: string | null;
  internalPath: string | null;
};

function metadataCompleted(value: unknown): boolean {
  return Boolean(value && typeof value === "object" && (value as { completed?: unknown }).completed === true);
}

function asDate(value: string | null): Date | null {
  const stored = portabilityDateForStorage(value);
  return stored ? new Date(`${stored}T00:00:00.000Z`) : null;
}

function safeText(value: string | null, limit: number): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed ? trimmed.slice(0, limit) : null;
}

export async function beginIntelligentRecycling(input: {
  operationId: string;
  baseOriginalId: string;
  criteria: RecyclingCriteria;
  files: FileInput[];
}) {
  const existing = await prisma.ejecucionReciclaje.findUnique({ where: { operacionId: input.operationId }, select: { id: true, baseOriginalId: true, estado: true } });
  if (existing) {
    if (existing.baseOriginalId !== input.baseOriginalId) throw new Error("La operación ya pertenece a otra base original.");
    return { id: existing.id, status: existing.estado, reused: true };
  }
  const effectiveDate = asDate(input.criteria.effectiveDate);
  const minimumDate = asDate(input.criteria.minimumDate);
  if (!effectiveDate || !minimumDate || input.criteria.minimumMonths !== 4 || input.criteria.minimumDate !== minimumPortabilityDate) throw new Error("Los criterios de permanencia no son válidos.");
  const base = await prisma.base.findUnique({ where: { id: input.baseOriginalId }, select: { tipo: true, metadatos: true } });
  if (!base || base.tipo !== "ORIGINAL" || !metadataCompleted(base.metadatos)) throw new Error("Selecciona una base original guardada.");

  return prisma.$transaction(async (tx) => {
    for (const file of input.files) {
      const stored = await tx.archivoTipificaciones.upsert({
        where: { importacionId: file.importId },
        create: { importacionId: file.importId, baseId: input.baseOriginalId, nombreArchivo: file.name, resumen: { version: 1, tipo: "CRM_TIPIFICACIONES" } },
        update: {},
        select: { baseId: true },
      });
      if (stored.baseId !== input.baseOriginalId) throw new Error("Un archivo histórico ya está asociado a otra base.");
    }
    const created = await tx.ejecucionReciclaje.create({
      data: {
        operacionId: input.operationId,
        baseOriginalId: input.baseOriginalId,
        fechaEfectiva: effectiveDate,
        metadatos: { version: 1, criteria: input.criteria, files: input.files.map((file) => ({ importId: file.importId, name: file.name })) } as unknown as Prisma.InputJsonValue,
      },
      select: { id: true, estado: true },
    });
    return { id: created.id, status: created.estado, reused: false };
  });
}

export async function appendRecyclingManagements(executionId: string, rows: ManagementInput[]) {
  const execution = await prisma.ejecucionReciclaje.findUnique({ where: { id: executionId }, select: { baseOriginalId: true, estado: true } });
  if (!execution || execution.estado !== "PREPARADA") throw new Error("La ejecución ya no admite nuevas gestiones.");
  const importIds = [...new Set(rows.map((row) => row.importId))];
  const files = await prisma.archivoTipificaciones.findMany({ where: { importacionId: { in: importIds }, baseId: execution.baseOriginalId }, select: { id: true, importacionId: true } });
  const fileIds = new Map(files.map((file) => [file.importacionId, file.id]));
  if (fileIds.size !== importIds.length) throw new Error("Archivo de tipificaciones no válido para esta base.");
  const data = rows.map((row) => {
    const mobile = normalizeSpanishMobile(row.mobile);
    if (!mobile || row.sourceRow < 2 || !Number.isInteger(row.sourceRow)) throw new Error("Gestión CRM no válida.");
    return {
      archivoId: fileIds.get(row.importId)!,
      ejecucionOrigenId: executionId,
      baseOriginalId: execution.baseOriginalId,
      numeroFilaOrigen: row.sourceRow,
      movilNormalizado: mobile,
      fechaGestion: asDate(row.managedAt),
      tipificacionOriginal: safeText(row.tipification, 300),
      tipificacionNormalizada: safeText(normalizeRecyclingTipification(row.tipification), 300),
      ventaConfirmada: row.confirmedSale,
      evidenciaVenta: safeText(row.saleEvidence, 500),
      metadatos: { version: 1, fileName: safeText(row.fileName, 180), sheetName: safeText(row.sheetName, 120), zipName: safeText(row.zipName, 180), internalPath: safeText(row.internalPath, 500), managedAtOriginal: safeText(row.managedAt, 80), saleAmbiguous: row.saleAmbiguous },
    };
  });
  const created = await prisma.gestionTipificacion.createMany({ data, skipDuplicates: true });
  return { accepted: created.count };
}

export async function finalizeIntelligentRecycling(executionId: string) {
  const execution = await prisma.ejecucionReciclaje.findUnique({ where: { id: executionId }, select: { id: true, baseOriginalId: true, fechaEfectiva: true, estado: true, metadatos: true } });
  if (!execution) throw new Error("Ejecución de reciclaje no encontrada.");
  if (execution.estado === "EVALUADA" || execution.estado === "BASE_GENERADA") return getRecyclingExecution(executionId);
  const claimed = await prisma.ejecucionReciclaje.updateMany({ where: { id: executionId, estado: "PREPARADA" }, data: { estado: "EVALUANDO" } });
  if (claimed.count !== 1) throw new Error("La ejecución ya está siendo evaluada.");
  try {
    const [records, managements] = await Promise.all([
      prisma.registro.findMany({ where: { baseId: execution.baseOriginalId }, select: { id: true, movilNormalizado: true, fechaPortabilidad: true } }),
      prisma.gestionTipificacion.findMany({ where: { baseOriginalId: execution.baseOriginalId }, select: { id: true, movilNormalizado: true, fechaGestion: true, tipificacionOriginal: true, ventaConfirmada: true, evidenciaVenta: true, metadatos: true } }),
    ]);
    const storedCriteria = (execution.metadatos as { criteria?: Partial<RecyclingCriteria> }).criteria;
    const criteria: RecyclingCriteria = {
      effectiveDate: execution.fechaEfectiva.toISOString().slice(0, 10),
      recyclableTipifications: storedCriteria?.recyclableTipifications ?? [],
      minimumMonths: 4,
      minimumDate: minimumPortabilityDate,
    };
    const evaluation = evaluateIntelligentRecycling(
      records.map((record) => ({ id: record.id, mobile: record.movilNormalizado, portabilityDate: record.fechaPortabilidad?.toISOString().slice(0, 10) ?? null })),
      managements.map((management) => ({ id: management.id, mobile: management.movilNormalizado, managedAt: management.fechaGestion?.toISOString().slice(0, 10) ?? null, tipificationOriginal: management.tipificacionOriginal, confirmedSale: management.ventaConfirmada, saleAmbiguous: Boolean((management.metadatos as { saleAmbiguous?: unknown }).saleAmbiguous), saleEvidence: management.evidenciaVenta })),
      criteria,
    );
    await prisma.$transaction(async (tx) => {
      await tx.resultadoEjecucionReciclaje.createMany({ data: evaluation.decisions.map((decision) => ({ ejecucionId: executionId, registroOriginalId: decision.originalRecordId, gestionGanadoraId: decision.winningManagementId, estado: decision.decision, motivo: decision.reason })) });
      await tx.ejecucionReciclaje.update({ where: { id: executionId }, data: { estado: "EVALUADA", metadatos: { ...(execution.metadatos as object), criteria, summary: evaluation.summary, incidentsOutsideBase: evaluation.incidentsOutsideBase } as unknown as Prisma.InputJsonValue } });
    });
  } catch (error) {
    await prisma.ejecucionReciclaje.updateMany({ where: { id: executionId, estado: "EVALUANDO" }, data: { estado: "ERROR" } });
    throw error;
  }
  return getRecyclingExecution(executionId);
}

export async function getRecyclingExecution(executionId: string) {
  const execution = await prisma.ejecucionReciclaje.findUnique({ where: { id: executionId }, include: { resultados: { select: { registroOriginalId: true, estado: true, motivo: true } } } });
  if (!execution) throw new Error("Ejecución de reciclaje no encontrada.");
  const metadata = execution.metadatos as { summary?: Record<string, number>; incidentsOutsideBase?: number; criteria?: RecyclingCriteria };
  return { id: execution.id, baseOriginalId: execution.baseOriginalId, status: execution.estado, criteria: metadata.criteria ?? null, summary: metadata.summary ?? null, incidentsOutsideBase: metadata.incidentsOutsideBase ?? 0, results: execution.resultados.map((result) => ({ originalRecordId: result.registroOriginalId, decision: result.estado, reason: result.motivo })) };
}

export async function linkGeneratedRecycledBase(tx: Prisma.TransactionClient, input: { executionId: string; baseId: string; baseOriginalId: string }) {
  const linked = await tx.ejecucionReciclaje.updateMany({ where: { id: input.executionId, baseOriginalId: input.baseOriginalId, estado: "EVALUADA", baseRecicladaId: null }, data: { baseRecicladaId: input.baseId, estado: "BASE_GENERADA" } });
  if (linked.count !== 1) throw new Error("La ejecución no está disponible para generar una base reciclada.");
}

export async function listRecyclingHistory(baseOriginalId: string) {
  return prisma.ejecucionReciclaje.findMany({ where: { baseOriginalId }, orderBy: { creadoEn: "desc" }, select: { id: true, fechaEfectiva: true, estado: true, creadoEn: true, baseRecicladaId: true, _count: { select: { resultados: true, gestiones: true } } } });
}
