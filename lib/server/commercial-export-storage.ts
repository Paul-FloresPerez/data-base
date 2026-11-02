import "server-only";

import type { Campana } from "@/generated/prisma/client";
import { lockCommercialMobiles } from "@/lib/server/commercial-locks";
import { prisma } from "@/lib/server/prisma";

export type CommercialLotSnapshot = {
  id: string;
  campaign: Campana;
  number: number;
  rows: { sourceRow: number; cells: string[] }[];
};

export type CommercialExportSnapshot = {
  baseId: string;
  baseName: string;
  kind: "ORIGINAL" | "RECICLADA";
  columns: string[];
  lots: CommercialLotSnapshot[];
};

/**
 * Reads only confirmed lots whose currently active reservations still match
 * every persisted record. It also records an idempotent download audit event.
 */
export async function prepareCommercialExport(input: { baseId: string; userId: string; campaign?: Campana; lotNumber?: number }) {
  return prisma.$transaction(async (transaction) => {
    const lots = await transaction.lote.findMany({
      where: { baseId: input.baseId, ...(input.campaign ? { campana: input.campaign } : {}), ...(input.lotNumber ? { numeroLote: input.lotNumber } : {}) },
      orderBy: [{ campana: "asc" }, { numeroLote: "asc" }],
      include: { registros: { include: { registro: true }, orderBy: { creadoEn: "asc" } } },
    });
    if (!lots.length) throw new Error("No hay lotes comerciales confirmados para descargar.");
    if (input.lotNumber && lots.length !== 1) throw new Error("El lote comercial solicitado no está disponible.");
    const base = await transaction.base.findUnique({ where: { id: input.baseId }, select: { nombreDescriptivo: true, tipo: true, metadatos: true } });
    if (!base) throw new Error("La base comercial no está disponible.");

    const entries = lots.flatMap((lot) => lot.registros.map(({ registro }) => ({ lot, registro })));
    const mobiles = entries.flatMap(({ registro }) => registro.movilNormalizado ? [registro.movilNormalizado] : []);
    if (mobiles.length !== entries.length) throw new Error("Un lote confirmado contiene un móvil no operativo.");
    await lockCommercialMobiles(transaction, mobiles);
    const [sales, reservations] = await Promise.all([
      transaction.ventaExterna.findMany({ where: { movilNormalizado: { in: mobiles }, estado: "CONFIRMADA" }, select: { movilNormalizado: true } }),
      transaction.reservaComercial.findMany({ where: { movilNormalizado: { in: mobiles }, estado: "ACTIVA" }, select: { movilNormalizado: true, baseId: true, loteId: true, campana: true } }),
    ]);
    if (sales.length) throw new Error("Un lote contiene un móvil con venta comercial confirmada.");
    const reservationByMobile = new Map(reservations.map((reservation) => [reservation.movilNormalizado, reservation]));
    for (const { lot, registro } of entries) {
      const reservation = reservationByMobile.get(registro.movilNormalizado!);
      if (!reservation || reservation.baseId !== input.baseId || reservation.loteId !== lot.id || reservation.campana !== lot.campana) {
        throw new Error("Un lote no conserva reservas comerciales activas coincidentes.");
      }
    }

    const metadata = base.metadatos as { enrichmentColumns?: unknown };
    const columns = Array.isArray(metadata.enrichmentColumns) && metadata.enrichmentColumns.every((value) => typeof value === "string")
      ? [...metadata.enrichmentColumns] as string[]
      : [];
    if (!columns.length) throw new Error("La salida enriquecida confirmada no está disponible.");
    const snapshotLots = lots.map((lot) => ({
      id: lot.id,
      campaign: lot.campana,
      number: lot.numeroLote,
      rows: lot.registros.map(({ registro }) => {
        const original = registro.datosOriginales as { enrichedCells?: unknown };
        if (!Array.isArray(original.enrichedCells)) throw new Error("Un registro confirmado no conserva su salida enriquecida.");
        return { sourceRow: registro.numeroFilaOriginal, cells: original.enrichedCells.map(String) };
      }),
    }));
    for (const lot of snapshotLots) {
      await transaction.registroExportacion.upsert({
        where: { operacionId: `commercial-download:${lot.id}` },
        create: { operacionId: `commercial-download:${lot.id}`, usuarioId: input.userId, baseId: input.baseId, campana: lot.campaign, loteId: lot.id, numeroLote: lot.number, tipo: "LOTE_COMERCIAL", cantidad: lot.rows.length, filtros: {}, metadatos: { source: "confirmed-reservation" } },
        update: {},
      });
      await transaction.eventoAuditoria.createMany({
        data: [{ operacionId: `commercial-download:${lot.id}:DESCARGA_INICIADA`, accion: "DESCARGA_INICIADA", usuarioId: input.userId, baseId: input.baseId, campana: lot.campaign, loteId: lot.id, cantidad: lot.rows.length, metadatos: { type: "LOTE_COMERCIAL", lotNumber: lot.number } }],
        skipDuplicates: true,
      });
    }
    return { baseId: input.baseId, baseName: base.nombreDescriptivo, kind: base.tipo, columns, lots: snapshotLots } satisfies CommercialExportSnapshot;
  });
}
