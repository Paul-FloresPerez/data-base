import "server-only";

import { createHash } from "node:crypto";
import { Prisma, type AccionAuditoria, type Campana, type EstadoExportacion } from "@/generated/prisma/client";
import type { SavedLot, StoredMetadata } from "@/lib/persistence/workspace-persistence";
import { prisma } from "@/lib/server/prisma";

type Transaction = Prisma.TransactionClient;

function fingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 24);
}

async function append(transaction: Transaction, event: {
  operationId: string; action: AccionAuditoria; userId: string; baseId: string; campaign?: Campana | null; lotId?: string | null; quantity?: number | null; metadata: Prisma.InputJsonValue;
}) {
  await transaction.eventoAuditoria.createMany({ data: [{
    operacionId: event.operationId, accion: event.action, usuarioId: event.userId, baseId: event.baseId,
    campana: event.campaign ?? null, loteId: event.lotId ?? null, cantidad: event.quantity ?? null, metadatos: event.metadata,
  }], skipDuplicates: true });
}

/** Writes only aggregate, non-contact lifecycle events inside the base transaction. */
export async function appendBaseLifecycleEvents(transaction: Transaction, input: { baseId: string; userId: string; metadata: StoredMetadata; imported: number; valid: number; excluded: number; lots: SavedLot[] }) {
  const baseEvent = await transaction.eventoAuditoria.findFirst({ where: { baseId: input.baseId, accion: input.metadata.kind === "RECICLADA" ? "BASE_RECICLADA" : "BASE_CREADA" }, select: { id: true } });
  if (!baseEvent) await append(transaction, {
    operationId: `base:${input.baseId}:${input.metadata.kind === "RECICLADA" ? "recycled" : "created"}`,
    action: input.metadata.kind === "RECICLADA" ? "BASE_RECICLADA" : "BASE_CREADA", userId: input.userId, baseId: input.baseId,
    quantity: input.imported, metadata: { kind: input.metadata.kind ?? "ORIGINAL", valid: input.valid, excluded: input.excluded, version: input.metadata.version },
  });
  if (input.metadata.enrichmentSource) await append(transaction, {
    operationId: `base:${input.baseId}:enrichment:${fingerprint({ source: input.metadata.enrichmentSource, columns: input.metadata.enrichmentColumns })}`,
    action: "ENRIQUECIMIENTO_APLICADO", userId: input.userId, baseId: input.baseId, quantity: input.valid,
    metadata: { source: input.metadata.enrichmentSource, columnCount: input.metadata.enrichmentColumns?.length ?? 0 },
  });
  await append(transaction, {
    operationId: `base:${input.baseId}:campaigns:${fingerprint({ filters: input.metadata.campaignFilters, selected: input.metadata.distribution.selectedCampaigns })}`,
    action: "CONFIGURACION_CAMPANA", userId: input.userId, baseId: input.baseId,
    metadata: { filters: input.metadata.campaignFilters, campaigns: input.metadata.distribution.selectedCampaigns, batchSize: input.metadata.distribution.batchSize },
  });
  if (input.lots.length) await append(transaction, {
    operationId: `base:${input.baseId}:lots:${fingerprint(input.lots.map((lot) => [lot.campaign, lot.number, lot.sourceRows.length]))}`,
    action: "LOTES_CREADOS", userId: input.userId, baseId: input.baseId, quantity: input.lots.reduce((total, lot) => total + lot.sourceRows.length, 0),
    metadata: { lots: input.lots.map((lot) => ({ campaign: lot.campaign, number: lot.number, count: lot.sourceRows.length })) },
  });
}

export async function listAudit(input: { baseId?: string; campaign?: Campana; action?: AccionAuditoria; from?: Date; to?: Date; cursor?: string; take: number }) {
  const where: Prisma.EventoAuditoriaWhereInput = {
    ...(input.baseId ? { baseId: input.baseId } : {}), ...(input.campaign ? { campana: input.campaign } : {}), ...(input.action ? { accion: input.action } : {}),
    ...(input.from || input.to ? { creadoEn: { ...(input.from ? { gte: input.from } : {}), ...(input.to ? { lte: input.to } : {}) } } : {}),
  };
  const events = await prisma.eventoAuditoria.findMany({ where, orderBy: [{ creadoEn: "desc" }, { id: "desc" }], take: input.take + 1, ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}), include: { usuario: { select: { username: true } }, base: { select: { nombreOriginal: true } } } });
  const page = events.slice(0, input.take);
  return { events: page.map((event) => ({ id: event.id, operationId: event.operacionId, createdAt: event.creadoEn.toISOString(), action: event.accion, user: event.usuario.username, baseId: event.baseId, baseName: event.base.nombreOriginal, campaign: event.campana, lotId: event.loteId, quantity: event.cantidad, metadata: event.metadatos })), nextCursor: events.length > input.take ? page.at(-1)?.id ?? null : null };
}

export async function recordExport(input: { operationId: string; userId: string; baseId: string; campaign: Campana | null; lotId: string | null; lotNumber: number | null; type: string; quantity: number; filters: Prisma.InputJsonValue; metadata: Prisma.InputJsonValue; state: EstadoExportacion }) {
  return prisma.$transaction(async (transaction) => {
    const existing = await transaction.registroExportacion.findUnique({ where: { operacionId: input.operationId } });
    const exportRecord = existing ?? await transaction.registroExportacion.create({ data: { operacionId: input.operationId, usuarioId: input.userId, baseId: input.baseId, campana: input.campaign, loteId: input.lotId, numeroLote: input.lotNumber, tipo: input.type, cantidad: input.quantity, filtros: input.filters, metadatos: input.metadata } });
    if (input.state === "DESCARGA_INICIADA" && exportRecord.estado === "GENERADO") {
      await transaction.registroExportacion.update({ where: { id: exportRecord.id }, data: { estado: "DESCARGA_INICIADA", descargaIniciadaEn: new Date() } });
    }
    await append(transaction, { operationId: `${input.operationId}:${input.state}`, action: input.state === "GENERADO" ? "EXPORTACION_GENERADA" : "DESCARGA_INICIADA", userId: input.userId, baseId: input.baseId, campaign: input.campaign, lotId: input.lotId, quantity: input.quantity, metadata: { type: input.type, lotNumber: input.lotNumber } });
    return { id: exportRecord.id };
  });
}

export async function confirmDelivery(input: { id: string; userId: string; recipient: string | null }) {
  return prisma.$transaction(async (transaction) => {
    const result = await transaction.registroExportacion.updateMany({ where: { id: input.id, estado: "DESCARGA_INICIADA" }, data: { estado: "ENTREGADO_CONFIRMADO", destinatario: input.recipient, entregaConfirmadaEn: new Date() } });
    if (!result.count) return false;
    const record = await transaction.registroExportacion.findUniqueOrThrow({ where: { id: input.id } });
    await append(transaction, { operationId: `${record.operacionId}:ENTREGADO_CONFIRMADO`, action: "ENTREGA_CONFIRMADA", userId: input.userId, baseId: record.baseId, campaign: record.campana, lotId: record.loteId, quantity: record.cantidad, metadata: { recipientProvided: Boolean(input.recipient), type: record.tipo, lotNumber: record.numeroLote } });
    return true;
  });
}
