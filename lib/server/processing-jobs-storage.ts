import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/server/prisma";
import {
  DEFAULT_PROCESSING_JOB_MAX_ATTEMPTS,
  assertProcessingJobShape,
  isProcessingJobType,
  progressPercentage,
  type ProcessingJobState,
  type ProcessingJobType,
} from "./processing-job-policy.ts";

type Json = Prisma.InputJsonValue;
type Transaction = Prisma.TransactionClient;

const MAX_LEASE_MS = 15 * 60_000;
const MIN_LEASE_MS = 1_000;
const publicFailureMessage = "El bloque no se completó y puede requerir reintento.";

export class ProcessingJobError extends Error {}

export type ProcessingJobSummary = {
  id: string;
  operationId: string;
  type: ProcessingJobType;
  state: ProcessingJobState;
  totalBlocks: number;
  completedBlocks: number;
  failedBlocks: number;
  progressPercent: number;
};

export type ClaimedProcessingBlock = {
  id: string;
  jobId: string;
  number: number;
  attempts: number;
  leaseUntil: Date;
};

function requireUuid(value: string, label: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new ProcessingJobError(`${label} no es válido.`);
  }
}

function safeErrorCode(value: string) {
  if (!/^[A-Z0-9_]{1,80}$/.test(value)) throw new ProcessingJobError("El código de error no es válido.");
  return value;
}

function asSummary(job: {
  id: string; operacionId: string; tipo: string; estado: string; totalBloques: number; bloquesCompletados: number; bloquesFallidos: number; progresoPorcentaje: number;
}): ProcessingJobSummary {
  return {
    id: job.id,
    operationId: job.operacionId,
    type: job.tipo as ProcessingJobType,
    state: job.estado as ProcessingJobState,
    totalBlocks: job.totalBloques,
    completedBlocks: job.bloquesCompletados,
    failedBlocks: job.bloquesFallidos,
    progressPercent: job.progresoPorcentaje,
  };
}

async function requireOwnedJob(tx: Transaction, jobId: string, userId: string) {
  const job = await tx.trabajoProcesamiento.findFirst({ where: { id: jobId, usuarioId: userId } });
  if (!job) throw new ProcessingJobError("El trabajo no está disponible.");
  return job;
}

async function lockOwnedJob(tx: Transaction, jobId: string, userId: string) {
  const rows = await tx.$queryRaw<Array<{ id: string; estado: string; maxIntentos: number }>>(Prisma.sql`
    SELECT id, estado::text AS estado, max_intentos AS "maxIntentos"
    FROM "trabajos_procesamiento"
    WHERE id = ${jobId}::uuid AND usuario_id = ${userId}::uuid
    FOR UPDATE
  `);
  if (!rows[0]) throw new ProcessingJobError("El trabajo no está disponible.");
  return rows[0];
}

async function synchronizeJobProgress(tx: Transaction, jobId: string) {
  const [job, grouped] = await Promise.all([
    tx.trabajoProcesamiento.findUniqueOrThrow({ where: { id: jobId } }),
    tx.bloqueTrabajoProcesamiento.groupBy({ by: ["estado"], where: { trabajoId: jobId }, _count: { _all: true } }),
  ]);
  if (job.estado === "CANCELADO") return asSummary(job);
  const count = (state: string) => grouped.find((entry) => entry.estado === state)?._count._all ?? 0;
  const completed = count("COMPLETADO");
  const failed = count("FALLIDO");
  const active = count("EN_PROCESO");
  const recoverable = count("RECUPERABLE");
  const pending = count("PENDIENTE");
  const state: ProcessingJobState = completed === job.totalBloques
    ? "COMPLETADO"
    : failed > 0 && active === 0 && recoverable === 0 && pending === 0
      ? "FALLIDO"
      : active > 0 ? "EN_PROCESO"
        : recoverable > 0 ? "RECUPERABLE"
          : "PENDIENTE";
  const updated = await tx.trabajoProcesamiento.update({
    where: { id: jobId },
    data: {
      estado: state,
      bloquesCompletados: completed,
      bloquesFallidos: failed,
      progresoPorcentaje: progressPercentage(completed, job.totalBloques),
      finalizadoEn: state === "COMPLETADO" || state === "FALLIDO" ? new Date() : null,
      codigoError: state === "FALLIDO" ? "BLOCK_RETRY_LIMIT_REACHED" : null,
      mensajeError: state === "FALLIDO" ? publicFailureMessage : null,
    },
  });
  return asSummary(updated);
}

export async function createProcessingJob(input: {
  operationId: string;
  type: ProcessingJobType;
  userId: string;
  baseId?: string | null;
  blockCount: number;
  maxAttempts?: number;
  metadata?: Json;
}) {
  requireUuid(input.operationId, "La operación");
  requireUuid(input.userId, "El usuario");
  if (input.baseId) requireUuid(input.baseId, "La base");
  if (!isProcessingJobType(input.type)) throw new ProcessingJobError("El tipo de trabajo no es válido.");
  const maxAttempts = input.maxAttempts ?? DEFAULT_PROCESSING_JOB_MAX_ATTEMPTS;
  assertProcessingJobShape(input.blockCount, maxAttempts);

  const existing = await prisma.trabajoProcesamiento.findUnique({ where: { operacionId: input.operationId } });
  if (existing) {
    if (existing.usuarioId !== input.userId || existing.tipo !== input.type || existing.baseId !== (input.baseId ?? null) || existing.totalBloques !== input.blockCount) {
      throw new ProcessingJobError("La operación ya existe con una configuración diferente.");
    }
    return { job: asSummary(existing), reused: true };
  }
  if (input.baseId) {
    const base = await prisma.base.findUnique({ where: { id: input.baseId }, select: { id: true } });
    if (!base) throw new ProcessingJobError("La base asociada no está disponible.");
  }
  try {
    const created = await prisma.trabajoProcesamiento.create({
      data: {
        operacionId: input.operationId,
        tipo: input.type,
        usuarioId: input.userId,
        baseId: input.baseId ?? null,
        totalBloques: input.blockCount,
        maxIntentos: maxAttempts,
        metadatos: (input.metadata ?? {}) as Json,
        bloques: { createMany: { data: Array.from({ length: input.blockCount }, (_, number) => ({ numeroBloque: number })) } },
      },
    });
    return { job: asSummary(created), reused: false };
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
    const concurrent = await prisma.trabajoProcesamiento.findUniqueOrThrow({ where: { operacionId: input.operationId } });
    if (concurrent.usuarioId !== input.userId || concurrent.tipo !== input.type || concurrent.baseId !== (input.baseId ?? null) || concurrent.totalBloques !== input.blockCount) {
      throw new ProcessingJobError("La operación ya existe con una configuración diferente.");
    }
    return { job: asSummary(concurrent), reused: true };
  }
}

/** Atomically claims one available block. SKIP LOCKED prevents double claims. */
export async function claimProcessingBlock(input: { jobId: string; userId: string; workerId: string; leaseMs: number; now?: Date }) {
  requireUuid(input.jobId, "El trabajo");
  requireUuid(input.userId, "El usuario");
  requireUuid(input.workerId, "El worker");
  if (!Number.isInteger(input.leaseMs) || input.leaseMs < MIN_LEASE_MS || input.leaseMs > MAX_LEASE_MS) {
    throw new ProcessingJobError("La duración del lease no es válida.");
  }
  const now = input.now ?? new Date();
  const leaseUntil = new Date(now.getTime() + input.leaseMs);
  return prisma.$transaction(async (tx) => {
    const job = await requireOwnedJob(tx, input.jobId, input.userId);
    if (job.estado === "COMPLETADO" || job.estado === "FALLIDO" || job.estado === "CANCELADO") return null;
    await tx.bloqueTrabajoProcesamiento.updateMany({
      where: { trabajoId: input.jobId, estado: "EN_PROCESO", leaseHasta: { lt: now } },
      data: { estado: "RECUPERABLE", workerId: null, leaseHasta: null, codigoError: "LEASE_EXPIRED", mensajeError: publicFailureMessage },
    });
    await tx.bloqueTrabajoProcesamiento.updateMany({
      where: { trabajoId: input.jobId, estado: { in: ["PENDIENTE", "RECUPERABLE"] }, intentos: { gte: job.maxIntentos } },
      data: { estado: "FALLIDO", codigoError: "BLOCK_RETRY_LIMIT_REACHED", mensajeError: publicFailureMessage },
    });
    const rows = await tx.$queryRaw<Array<{ id: string; numeroBloque: number; intentos: number }>>(Prisma.sql`
      WITH candidato AS (
        SELECT id
        FROM "bloques_trabajos_procesamiento"
        WHERE trabajo_id = ${input.jobId}::uuid
          AND estado IN ('PENDIENTE', 'RECUPERABLE')
          AND intentos < ${job.maxIntentos}
        ORDER BY numero_bloque ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      UPDATE "bloques_trabajos_procesamiento" AS bloque
      SET estado = 'EN_PROCESO',
          intentos = bloque.intentos + 1,
          worker_id = ${input.workerId},
          reclamado_en = COALESCE(bloque.reclamado_en, ${now}),
          lease_hasta = ${leaseUntil},
          codigo_error = NULL,
          mensaje_error = NULL,
          actualizado_en = ${now}
      FROM candidato
      WHERE bloque.id = candidato.id
      RETURNING bloque.id, bloque.numero_bloque AS "numeroBloque", bloque.intentos
    `);
    const row = rows[0];
    if (!row) {
      await synchronizeJobProgress(tx, input.jobId);
      return null;
    }
    await tx.trabajoProcesamiento.update({ where: { id: input.jobId }, data: { estado: "EN_PROCESO", iniciadoEn: job.iniciadoEn ?? now, finalizadoEn: null, codigoError: null, mensajeError: null } });
    return { id: row.id, jobId: input.jobId, number: row.numeroBloque, attempts: row.intentos, leaseUntil } satisfies ClaimedProcessingBlock;
  });
}

/**
 * Runs the caller's already-processed database write and stores its checkpoint
 * in the same short transaction. Processing itself must happen before this call.
 */
export async function completeProcessingBlock(input: {
  jobId: string; blockId: string; userId: string; workerId: string; checkpoint?: Json; summary?: Json; apply?: (tx: Transaction) => Promise<void>;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  return prisma.$transaction(async (tx) => {
    const job = await lockOwnedJob(tx, input.jobId, input.userId);
    if (job.estado === "CANCELADO") throw new ProcessingJobError("El trabajo fue cancelado.");
    const rows = await tx.$queryRaw<Array<{ id: string; estado: string; workerId: string | null; leaseHasta: Date | null }>>(Prisma.sql`
      SELECT id, estado::text AS estado, worker_id AS "workerId", lease_hasta AS "leaseHasta"
      FROM "bloques_trabajos_procesamiento"
      WHERE id = ${input.blockId}::uuid AND trabajo_id = ${input.jobId}::uuid
      FOR UPDATE
    `);
    const block = rows[0];
    if (!block || block.estado !== "EN_PROCESO" || block.workerId !== input.workerId || !block.leaseHasta || block.leaseHasta < now) {
      throw new ProcessingJobError("La reclamación del bloque ya no es válida.");
    }
    await input.apply?.(tx);
    await tx.bloqueTrabajoProcesamiento.update({
      where: { id: input.blockId },
      data: { estado: "COMPLETADO", checkpoint: input.checkpoint, resumen: input.summary, completadoEn: now, leaseHasta: null, workerId: null, codigoError: null, mensajeError: null },
    });
    return synchronizeJobProgress(tx, input.jobId);
  });
}

export async function failProcessingBlock(input: { jobId: string; blockId: string; userId: string; workerId: string; errorCode: string; now?: Date }) {
  const now = input.now ?? new Date();
  const errorCode = safeErrorCode(input.errorCode);
  return prisma.$transaction(async (tx) => {
    const job = await lockOwnedJob(tx, input.jobId, input.userId);
    if (job.estado === "CANCELADO") throw new ProcessingJobError("El trabajo fue cancelado.");
    const block = await tx.bloqueTrabajoProcesamiento.findFirst({ where: { id: input.blockId, trabajoId: input.jobId } });
    if (!block || block.estado !== "EN_PROCESO" || block.workerId !== input.workerId || !block.leaseHasta || block.leaseHasta < now) {
      throw new ProcessingJobError("La reclamación del bloque ya no es válida.");
    }
    const state = block.intentos >= job.maxIntentos ? "FALLIDO" : "RECUPERABLE";
    await tx.bloqueTrabajoProcesamiento.update({ where: { id: block.id }, data: { estado: state, workerId: null, leaseHasta: null, codigoError: errorCode, mensajeError: publicFailureMessage } });
    return synchronizeJobProgress(tx, input.jobId);
  });
}

/** Cancellation preserves every block/history and prevents further claims or commits. */
export async function cancelProcessingJob(input: { jobId: string; userId: string }) {
  return prisma.$transaction(async (tx) => {
    const job = await lockOwnedJob(tx, input.jobId, input.userId);
    if (job.estado === "COMPLETADO") throw new ProcessingJobError("Un trabajo completado no puede cancelarse.");
    if (job.estado === "CANCELADO") return asSummary(await tx.trabajoProcesamiento.findUniqueOrThrow({ where: { id: input.jobId } }));
    await tx.bloqueTrabajoProcesamiento.updateMany({ where: { trabajoId: input.jobId, estado: { not: "COMPLETADO" } }, data: { estado: "CANCELADO", workerId: null, leaseHasta: null } });
    const updated = await tx.trabajoProcesamiento.update({ where: { id: input.jobId }, data: { estado: "CANCELADO", finalizadoEn: new Date(), codigoError: null, mensajeError: null } });
    return asSummary(updated);
  });
}

export async function getProcessingJob(input: { jobId: string; userId: string }) {
  const job = await requireOwnedJob(prisma, input.jobId, input.userId);
  const blocks = await prisma.bloqueTrabajoProcesamiento.findMany({
    where: { trabajoId: input.jobId },
    orderBy: { numeroBloque: "asc" },
    select: { id: true, numeroBloque: true, estado: true, intentos: true, reclamadoEn: true, leaseHasta: true, completadoEn: true, codigoError: true },
  });
  return { job: asSummary(job), blocks: blocks.map((block) => ({ id: block.id, number: block.numeroBloque, state: block.estado as ProcessingJobState, attempts: block.intentos, claimedAt: block.reclamadoEn, leaseUntil: block.leaseHasta, completedAt: block.completadoEn, errorCode: block.codigoError })) };
}

export async function attachProcessingFile(input: { jobId: string; userId: string; originalName: string; contentType?: string | null; bytes: number; contentHash: string; privateReference: string; metadata?: Json }) {
  if (!input.originalName.trim() || input.originalName.length > 500 || !Number.isInteger(input.bytes) || input.bytes < 0 || !/^[a-f0-9]{64}$/i.test(input.contentHash) || !input.privateReference.trim()) {
    throw new ProcessingJobError("Los metadatos del archivo no son válidos.");
  }
  await requireOwnedJob(prisma, input.jobId, input.userId);
  const existing = await prisma.archivoProcesamiento.findUnique({ where: { trabajoId_huellaContenido: { trabajoId: input.jobId, huellaContenido: input.contentHash } } });
  if (existing) return { id: existing.id, reused: true };
  try {
    const file = await prisma.archivoProcesamiento.create({ data: { trabajoId: input.jobId, nombreOriginal: input.originalName.trim(), tipoContenido: input.contentType?.trim() || null, tamanoBytes: input.bytes, huellaContenido: input.contentHash.toLowerCase(), referenciaPrivada: input.privateReference.trim(), metadatos: (input.metadata ?? {}) as Json } });
    return { id: file.id, reused: false };
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
    const concurrent = await prisma.archivoProcesamiento.findUnique({ where: { trabajoId_huellaContenido: { trabajoId: input.jobId, huellaContenido: input.contentHash.toLowerCase() } } });
    if (!concurrent) throw error;
    return { id: concurrent.id, reused: true };
  }
}
