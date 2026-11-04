import "server-only";

import { createHash } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { normalizeSpanishMobile } from "@/lib/excel/cleaning";
import { portabilityDateForStorage } from "@/lib/excel/portability-date";
import { evaluateIntelligentRecycling, minimumPortabilityDate, normalizeRecyclingTipification, type RecyclingCriteria } from "@/lib/recycling/intelligent-recycling";
import { nextBaseCode } from "@/lib/server/base-code";
import { lockCommercialMobiles } from "@/lib/server/commercial-locks";
import { prisma } from "@/lib/server/prisma";
import { confirmedExternalSales } from "@/lib/server/sales-storage";
import { conciliateCrmRows, type ConciliationRow, type ConciliationSummary } from "@/lib/recycling/conciliation";

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

function fingerprintConciliation(rows: readonly ConciliationRow[]): string {
  return createHash("sha256").update(JSON.stringify(rows.map((row) => [row.fileId, row.sourceRow, row.mobile]))).digest("hex");
}

export async function previewRecyclingConciliation(input: { executionId: string; userId: string; rows: ConciliationRow[] }) {
  const execution = await prisma.ejecucionReciclaje.findUnique({ where: { id: input.executionId }, select: { baseOriginalId: true, usuarioId: true, estado: true, metadatos: true } });
  if (!execution || execution.estado !== "PREPARADA" || execution.usuarioId !== input.userId) throw new Error("La ejecución no está disponible para conciliación.");
  if (input.rows.length > 10_000 || input.rows.some((row) => !row.fileId || !row.fileName.trim() || !Number.isInteger(row.sourceRow) || row.sourceRow < 2 || typeof row.mobile !== "string" || row.mobile.length > 80)) throw new Error("Las filas de conciliación no son válidas.");
  const files = await prisma.archivoTipificaciones.findMany({ where: { importacionId: { in: [...new Set(input.rows.map((row) => row.fileId))] }, baseId: execution.baseOriginalId }, select: { id: true, importacionId: true, resumen: true } });
  if (files.length !== new Set(input.rows.map((row) => row.fileId)).size) throw new Error("Archivo de tipificaciones no válido para esta base.");
  const normalized = [...new Set(input.rows.flatMap((row) => { const mobile = normalizeSpanishMobile(row.mobile); return mobile ? [mobile] : []; }))];
  const existingMobiles = new Set<string>();
  for (let index = 0; index < normalized.length; index += 1_000) {
    const rows = await prisma.registro.findMany({ where: { baseId: execution.baseOriginalId, movilNormalizado: { in: normalized.slice(index, index + 1_000) } }, select: { movilNormalizado: true } });
    for (const row of rows) if (row.movilNormalizado) existingMobiles.add(row.movilNormalizado);
  }
  const summary = conciliateCrmRows(input.rows, existingMobiles);
  const fingerprint = fingerprintConciliation(input.rows);
  const metadata = execution.metadatos as Record<string, unknown>;
  const previous = metadata.conciliation as { fingerprint?: unknown } | undefined;
  if (previous?.fingerprint && previous.fingerprint !== fingerprint) throw new Error("La conciliación ya fue preparada con archivos distintos.");
  await prisma.$transaction(async (tx) => {
    for (const file of files) {
      const fileSummary = summary.files.find((item) => item.fileId === file.importacionId);
      if (!fileSummary) continue;
      await tx.archivoTipificaciones.update({ where: { id: file.id }, data: { resumen: { ...(file.resumen as object), conciliacion: fileSummary } as Prisma.InputJsonValue } });
    }
    await tx.ejecucionReciclaje.update({ where: { id: input.executionId }, data: { metadatos: { ...metadata, conciliacion: { version: 1, status: "PREVISUALIZADA", fingerprint, summary } } as Prisma.InputJsonValue } });
  });
  return summary;
}

export async function beginIntelligentRecycling(input: {
  operationId: string;
  baseOriginalId: string;
  userId: string;
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
  const base = await prisma.base.findUnique({
    where: { id: input.baseOriginalId },
    select: {
      tipo: true,
      metadatos: true,
      estado: true,
      cantidadValidos: true,
      _count: { select: { registros: { where: { tipificacion: "VALIDO" } } } },
    },
  });
  if (!base || base.tipo !== "ORIGINAL" || !metadataCompleted(base.metadatos)) throw new Error("Selecciona una base original guardada.");
  if (base.estado === "LISTA_PARA_LIMPIAR" || base.cantidadValidos <= 0 || base._count.registros !== base.cantidadValidos) {
    throw new Error("La base original no tiene una limpieza guardada correctamente. Ábrela, ejecuta Limpieza y pulsa Reintentar antes de reciclarla.");
  }

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
        usuarioId: input.userId,
        fechaEfectiva: effectiveDate,
        metadatos: { version: 1, criteria: input.criteria, files: input.files.map((file) => ({ importId: file.importId, name: file.name })) } as unknown as Prisma.InputJsonValue,
      },
      select: { id: true, estado: true },
    });
    return { id: created.id, status: created.estado, reused: false };
  });
}

export async function appendRecyclingManagements(executionId: string, userId: string, rows: ManagementInput[]) {
  const execution = await prisma.ejecucionReciclaje.findUnique({ where: { id: executionId }, select: { baseOriginalId: true, usuarioId: true, estado: true, metadatos: true } });
  if (!execution || execution.estado !== "PREPARADA" || execution.usuarioId !== userId) throw new Error("La ejecución ya no admite nuevas gestiones.");
  if ((execution.metadatos as { conciliacion?: { status?: string } }).conciliacion?.status !== "PREVISUALIZADA") throw new Error("Confirma primero la conciliación de los archivos CRM.");
  const importIds = [...new Set(rows.map((row) => row.importId))];
  const files = await prisma.archivoTipificaciones.findMany({ where: { importacionId: { in: importIds }, baseId: execution.baseOriginalId }, select: { id: true, importacionId: true } });
  const fileIds = new Map(files.map((file) => [file.importacionId, file.id]));
  if (fileIds.size !== importIds.length) throw new Error("Archivo de tipificaciones no válido para esta base.");
  const normalizedRows = rows.flatMap((row) => {
    const mobile = normalizeSpanishMobile(row.mobile);
    if (!mobile || row.sourceRow < 2 || !Number.isInteger(row.sourceRow)) return [];
    return [{ row, mobile }];
  });
  const matched = new Set((await prisma.registro.findMany({ where: { baseId: execution.baseOriginalId, movilNormalizado: { in: [...new Set(normalizedRows.map((item) => item.mobile))] } }, select: { movilNormalizado: true } })).flatMap((record) => record.movilNormalizado ? [record.movilNormalizado] : []));
  const data = normalizedRows.filter((item) => matched.has(item.mobile)).map(({ row, mobile }) => {
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
  return { accepted: created.count, skippedExternal: normalizedRows.length - data.length, skippedInvalid: rows.length - normalizedRows.length };
}

export async function finalizeIntelligentRecycling(executionId: string, userId: string) {
  const execution = await prisma.ejecucionReciclaje.findUnique({ where: { id: executionId }, select: { id: true, baseOriginalId: true, usuarioId: true, fechaEfectiva: true, estado: true, metadatos: true } });
  if (!execution) throw new Error("Ejecución de reciclaje no encontrada.");
  if (execution.usuarioId !== userId) throw new Error("La ejecución pertenece a otro usuario.");
  if ((execution.metadatos as { conciliacion?: { status?: string } }).conciliacion?.status !== "PREVISUALIZADA") throw new Error("Confirma primero la conciliación de los archivos CRM.");
  if (execution.estado === "EVALUADA" || execution.estado === "BASE_GENERADA") return getRecyclingExecution(executionId);
  const claimed = await prisma.ejecucionReciclaje.updateMany({ where: { id: executionId, estado: "PREPARADA" }, data: { estado: "EVALUANDO" } });
  if (claimed.count !== 1) throw new Error("La ejecución ya está siendo evaluada.");
  try {
    const [records, managements] = await Promise.all([
      prisma.registro.findMany({ where: { baseId: execution.baseOriginalId }, select: { id: true, movilNormalizado: true, fechaPortabilidad: true, tipificacion: true } }),
      prisma.gestionTipificacion.findMany({ where: { baseOriginalId: execution.baseOriginalId }, select: { id: true, movilNormalizado: true, fechaGestion: true, tipificacionOriginal: true, ventaConfirmada: true, evidenciaVenta: true, metadatos: true } }),
    ]);
    const storedCriteria = (execution.metadatos as { criteria?: Partial<RecyclingCriteria> }).criteria;
    const criteria: RecyclingCriteria = {
      effectiveDate: execution.fechaEfectiva.toISOString().slice(0, 10),
      recyclableTipifications: storedCriteria?.recyclableTipifications ?? [],
      minimumMonths: 4,
      minimumDate: minimumPortabilityDate,
    };
    const mobiles = records.flatMap((record) => record.movilNormalizado ? [record.movilNormalizado] : []);
    const [externallyBlocked, activeReservations] = await Promise.all([
      confirmedExternalSales(mobiles),
      prisma.reservaComercial.findMany({ where: { movilNormalizado: { in: mobiles }, estado: "ACTIVA" }, select: { movilNormalizado: true } }),
    ]);
    const evaluation = evaluateIntelligentRecycling(
      records.filter((record) => record.tipificacion === "VALIDO").map((record) => ({ id: record.id, mobile: record.movilNormalizado, portabilityDate: record.fechaPortabilidad?.toISOString().slice(0, 10) ?? null })),
      managements.map((management) => ({ id: management.id, mobile: management.movilNormalizado, managedAt: management.fechaGestion?.toISOString().slice(0, 10) ?? null, tipificationOriginal: management.tipificacionOriginal, confirmedSale: management.ventaConfirmada, saleAmbiguous: Boolean((management.metadatos as { saleAmbiguous?: unknown }).saleAmbiguous), saleEvidence: management.evidenciaVenta })),
      criteria,
      externallyBlocked,
      new Set(activeReservations.map((reservation) => reservation.movilNormalizado)),
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
  const execution = await prisma.ejecucionReciclaje.findUnique({
    where: { id: executionId },
    include: {
      usuario: { select: { username: true } },
      resultados: { select: { registroOriginalId: true, estado: true, motivo: true } },
      gestiones: { select: { archivo: { select: { nombreArchivo: true } } } },
    },
  });
  if (!execution) throw new Error("Ejecución de reciclaje no encontrada.");
  const metadata = execution.metadatos as { summary?: Record<string, number>; incidentsOutsideBase?: number; criteria?: RecyclingCriteria; conciliacion?: { summary?: ConciliationSummary } };
  return {
    id: execution.id,
    baseOriginalId: execution.baseOriginalId,
    recycledBaseId: execution.baseRecicladaId,
    status: execution.estado,
    createdAt: execution.creadoEn.toISOString(),
    effectiveDate: execution.fechaEfectiva.toISOString().slice(0, 10),
    user: execution.usuario?.username ?? "Histórico",
    criteria: metadata.criteria ?? null,
    summary: metadata.summary ?? null,
    incidentsOutsideBase: metadata.incidentsOutsideBase ?? 0,
    conciliation: metadata.conciliacion?.summary ?? null,
    files: [...new Set(execution.gestiones.map((management) => management.archivo.nombreArchivo))],
    results: execution.resultados.map((result) => ({ originalRecordId: result.registroOriginalId, decision: result.estado, reason: result.motivo })),
  };
}

/**
 * Atomically creates the derived base from an evaluated snapshot. No client
 * records are accepted here: the source rows are copied directly from the
 * selected original base, so a retry or a double click cannot mix sessions.
 */
export async function confirmIntelligentRecycling(executionId: string, userId: string) {
  return prisma.$transaction(async (tx) => {
    const execution = await tx.ejecucionReciclaje.findUnique({
      where: { id: executionId },
      include: {
        baseOriginal: { include: { registros: { orderBy: { numeroFilaOriginal: "asc" } } } },
        resultados: { where: { estado: "ELEGIBLE" }, select: { registroOriginalId: true } },
      },
    });
    if (!execution) throw new Error("Ejecución de reciclaje no encontrada.");
    if (execution.usuarioId && execution.usuarioId !== userId) throw new Error("La ejecución pertenece a otro usuario.");
    if (execution.baseRecicladaId && execution.estado === "BASE_GENERADA") {
      return { baseId: execution.baseRecicladaId, reused: true };
    }

    // EVALUANDO acts as the short-lived transaction claim. PostgreSQL makes a
    // concurrent conditional update wait, then fail its predicate after the
    // winning transaction commits, so at most one derived base can be made.
    const claimed = await tx.ejecucionReciclaje.updateMany({
      where: { id: executionId, estado: "EVALUADA", baseRecicladaId: null },
      data: { estado: "EVALUANDO" },
    });
    if (claimed.count !== 1) {
      const latest = await tx.ejecucionReciclaje.findUnique({ where: { id: executionId }, select: { estado: true, baseRecicladaId: true } });
      if (latest?.estado === "BASE_GENERADA" && latest.baseRecicladaId) return { baseId: latest.baseRecicladaId, reused: true };
      throw new Error("La ejecución no está lista para confirmarse.");
    }

    const original = execution.baseOriginal;
    if (original.tipo !== "ORIGINAL" || !metadataCompleted(original.metadatos)) throw new Error("La base original no está disponible para reciclaje.");
    const eligibleIds = new Set(execution.resultados.map((result) => result.registroOriginalId));
    const records = original.registros.filter((record) => eligibleIds.has(record.id));
    const mobiles = records.flatMap((record) => record.movilNormalizado ? [record.movilNormalizado] : []);
    await lockCommercialMobiles(tx, mobiles);
    const [confirmedSales, activeReservations] = await Promise.all([
      tx.ventaExterna.findMany({ where: { movilNormalizado: { in: mobiles }, estado: "CONFIRMADA" }, select: { movilNormalizado: true } }),
      tx.reservaComercial.findMany({ where: { movilNormalizado: { in: mobiles }, estado: "ACTIVA" }, select: { movilNormalizado: true } }),
    ]);
    if (confirmedSales.length || activeReservations.length) {
      throw new Error("La elegibilidad cambió por una venta o reserva comercial activa; vuelve a evaluar el reciclaje.");
    }
    const originalMetadata = original.metadatos as Record<string, unknown>;
    const recycledMetadata = {
      ...originalMetadata,
      completed: true,
      revision: null,
      originalFileName: `RECICLADA_${original.nombreOriginal}`,
      kind: "RECICLADA",
      originalBaseId: original.id,
      originalBaseCode: original.codigo,
      recyclingExecutionId: execution.id,
      operationalSourceRows: records.map((record) => record.numeroFilaOriginal),
      exportCompletedAt: null,
    } as Prisma.InputJsonValue;
    const code = await nextBaseCode(tx, original.fechaRecepcion);
    const recycled = await tx.base.create({
      data: {
        codigo: code,
        nombreOriginal: `RECICLADA_${original.nombreOriginal}`,
        nombreDescriptivo: `Reciclada · ${original.nombreDescriptivo}`.slice(0, 180),
        fechaRecepcion: original.fechaRecepcion,
        tipo: "RECICLADA",
        baseOriginalId: original.id,
        estado: originalMetadata.enrichmentColumns ? "LISTA_PARA_DISTRIBUIR" : "LISTA_PARA_ENRIQUECER",
        cantidadImportados: records.length,
        cantidadValidos: records.length,
        cantidadExcluidos: 0,
        metadatos: recycledMetadata,
      },
      select: { id: true },
    });
    if (records.length) {
      await tx.registro.createMany({
        data: records.map((record) => ({
          baseId: recycled.id,
          numeroFilaOriginal: record.numeroFilaOriginal,
          movilNormalizado: record.movilNormalizado,
          documento: record.documento,
          nombre: record.nombre,
          operadorActual: record.operadorActual,
          operadorOriginal: record.operadorOriginal,
          fechaPortabilidad: record.fechaPortabilidad,
          tipificacion: record.tipificacion,
          datosOriginales: record.datosOriginales === null ? Prisma.JsonNull : record.datosOriginales as Prisma.InputJsonValue,
        })),
      });
    }
    await tx.ejecucionReciclaje.update({ where: { id: executionId }, data: { baseRecicladaId: recycled.id, estado: "BASE_GENERADA" } });
    await tx.eventoAuditoria.createMany({
      data: [{
        operacionId: `reciclaje:${execution.id}:base-generada`,
        accion: "BASE_RECICLADA",
        usuarioId: userId,
        baseId: recycled.id,
        cantidad: records.length,
        metadatos: { executionId: execution.id, originalBaseId: original.id, eligible: records.length },
      }],
      skipDuplicates: true,
    });
    return { baseId: recycled.id, reused: false };
  });
}

export async function linkGeneratedRecycledBase(tx: Prisma.TransactionClient, input: { executionId: string; baseId: string; baseOriginalId: string }) {
  // A server-confirmed execution already owns this base. The normal autosave
  // may later persist campaign settings for that same UUID; treat it as an
  // idempotent continuation, never as a second recycling confirmation.
  const linked = await tx.ejecucionReciclaje.updateMany({
    where: {
      id: input.executionId,
      baseOriginalId: input.baseOriginalId,
      OR: [
        { estado: "EVALUADA", baseRecicladaId: null },
        { estado: "BASE_GENERADA", baseRecicladaId: input.baseId },
      ],
    },
    data: { baseRecicladaId: input.baseId, estado: "BASE_GENERADA" },
  });
  if (linked.count !== 1) throw new Error("La ejecución no está disponible para generar una base reciclada.");
}

export async function listRecyclingHistory(baseOriginalId: string) {
  const executions = await prisma.ejecucionReciclaje.findMany({
    where: { baseOriginalId },
    orderBy: { creadoEn: "desc" },
    include: {
      usuario: { select: { username: true } },
      resultados: { select: { estado: true } },
      gestiones: { select: { archivo: { select: { nombreArchivo: true } } } },
    },
  });
  return executions.map((execution) => {
    const metadata = execution.metadatos as { criteria?: RecyclingCriteria; summary?: Record<string, number>; incidentsOutsideBase?: number; conciliacion?: { summary?: ConciliationSummary } };
    const counts = execution.resultados.reduce<Record<string, number>>((result, row) => ({ ...result, [row.estado]: (result[row.estado] ?? 0) + 1 }), {});
    return {
      id: execution.id,
      effectiveDate: execution.fechaEfectiva.toISOString().slice(0, 10),
      createdAt: execution.creadoEn.toISOString(),
      status: execution.estado,
      user: execution.usuario?.username ?? "Histórico",
      recycledBaseId: execution.baseRecicladaId,
      criteria: metadata.criteria ?? null,
      files: [...new Set(execution.gestiones.map((management) => management.archivo.nombreArchivo))],
      summary: metadata.summary ?? counts,
      incidentsOutsideBase: metadata.incidentsOutsideBase ?? 0,
      conciliation: metadata.conciliacion?.summary ?? null,
    };
  });
}
