import "server-only";

import { Prisma, type Campana } from "@/generated/prisma/client";
import { prisma } from "@/lib/server/prisma";
import { lockCommercialMobiles } from "@/lib/server/commercial-locks";

type Transaction = Prisma.TransactionClient;

export type CommercialReservationInput = {
  baseId: string;
  loteId: string;
  campaign: Campana;
  mobile: string;
  operationId: string;
};

/**
 * Persists holds only after lots have been created in the same transaction.
 * The partial unique index is the final cross-instance safeguard; callers must
 * acquire the per-mobile advisory locks before calling this function.
 */
export async function createCommercialReservations(
  transaction: Transaction,
  input: { userId: string; matrixVersion: string; reservations: readonly CommercialReservationInput[] },
) {
  const mobiles = [...new Set(input.reservations.map((reservation) => reservation.mobile))];
  if (!mobiles.length) return;
  if (mobiles.length !== input.reservations.length) {
    throw new Error("Un móvil no puede reservarse dos veces en la misma distribución.");
  }

  const active = await transaction.reservaComercial.findMany({
    where: { movilNormalizado: { in: mobiles }, estado: "ACTIVA" },
    select: { movilNormalizado: true },
  });
  if (active.length) throw new Error("Uno o más móviles ya tienen una reserva comercial activa.");

  try {
    await transaction.reservaComercial.createMany({
      data: input.reservations.map((reservation) => ({
        movilNormalizado: reservation.mobile,
        baseId: reservation.baseId,
        loteId: reservation.loteId,
        campana: reservation.campaign,
        usuarioId: input.userId,
        operacionId: reservation.operationId,
        metadatos: { version: 1, matrixVersion: input.matrixVersion },
      })),
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new Error("Uno o más móviles ya tienen una reserva comercial activa.");
    }
    throw error;
  }

  const byLot = new Map<string, CommercialReservationInput[]>();
  for (const reservation of input.reservations) {
    const reservations = byLot.get(reservation.loteId) ?? [];
    reservations.push(reservation);
    byLot.set(reservation.loteId, reservations);
  }
  await transaction.eventoAuditoria.createMany({
    data: [...byLot.entries()].map(([loteId, reservations]) => ({
      operacionId: `reservation-lot:${loteId}`,
      accion: "RESERVAS_CREADAS" as const,
      usuarioId: input.userId,
      baseId: reservations[0]!.baseId,
      loteId,
      campana: reservations[0]!.campaign,
      cantidad: reservations.length,
      metadatos: { matrixVersion: input.matrixVersion },
    })),
    skipDuplicates: true,
  });
}

/**
 * Transfers only holds explicitly captured by an immutable global-recycling
 * snapshot. It is intentionally transaction-scoped: releasing the previous
 * assignment and creating the replacement can never commit separately.
 */
export async function transitionCommercialReservations(
  transaction: Transaction,
  input: {
    userId: string;
    executionId: string;
    operationId: string;
    replacements: readonly CommercialReservationInput[];
    priorReservationIdsByMobile: ReadonlyMap<string, readonly string[]>;
  },
) {
  const mobiles = [...new Set(input.replacements.map((reservation) => reservation.mobile))];
  if (!mobiles.length) return { released: 0 };
  const active = await transaction.reservaComercial.findMany({
    where: { movilNormalizado: { in: mobiles }, estado: "ACTIVA" },
    select: { id: true, movilNormalizado: true, baseId: true, loteId: true, campana: true },
  });
  const replacementByMobile = new Map(input.replacements.map((reservation) => [reservation.mobile, reservation]));
  for (const reservation of active) {
    const allowed = new Set(input.priorReservationIdsByMobile.get(reservation.movilNormalizado) ?? []);
    if (!allowed.has(reservation.id)) {
      throw new Error("Una reserva activa no corresponde al snapshot de reciclaje; crea una nueva evaluación.");
    }
  }
  if (!active.length) return { released: 0 };

  const now = new Date();
  // A transition can cover several 100-record lots. One parameterized UPDATE
  // keeps that work within the same transaction without one network round trip
  // per historical reservation; the state predicate remains the final guard.
  const released = await transaction.$executeRaw(Prisma.sql`
    UPDATE "reservas_comerciales" AS reserva
    SET "estado" = 'LIBERADA',
        "liberada_en" = ${now},
        "liberada_por_usuario_id" = ${input.userId}::uuid,
        "operacion_liberacion_id" = transicion.operacion_id
    FROM (VALUES ${Prisma.join(active.map((reservation) => Prisma.sql`(${reservation.id}::uuid, ${`recycling-transition:${input.operationId}:${reservation.id}`})`))})
      AS transicion(id, operacion_id)
    WHERE reserva."id" = transicion.id AND reserva."estado" = 'ACTIVA'
  `);
  if (released !== active.length) throw new Error("No se pudo cerrar una reserva anterior de forma atómica.");
  await transaction.eventoAuditoria.createMany({
    data: active.map((reservation) => {
      const replacement = replacementByMobile.get(reservation.movilNormalizado)!;
      return {
        operacionId: `recycling-transition:${input.operationId}:${reservation.id}`,
        accion: "RESERVA_LIBERADA" as const,
        usuarioId: input.userId,
        baseId: reservation.baseId,
        loteId: reservation.loteId,
        campana: reservation.campana,
        cantidad: 1,
        metadatos: {
          reason: "TRANSICION_RECICLAJE_AUTORIZADA",
          executionId: input.executionId,
          newBaseId: replacement.baseId,
          newLotId: replacement.loteId,
          newCampaign: replacement.campaign,
        },
      };
    }),
    skipDuplicates: true,
  });
  return { released: active.length };
}

/** Releases a hold explicitly; the historical reservation is never deleted. */
export async function releaseCommercialReservation(input: { id: string; userId: string; operationId: string }) {
  return prisma.$transaction(async (transaction) => {
    const initial = await transaction.reservaComercial.findUnique({ where: { id: input.id } });
    if (!initial) return false;
    await lockCommercialMobiles(transaction, [initial.movilNormalizado]);
    const reservation = await transaction.reservaComercial.findUnique({ where: { id: input.id } });
    if (!reservation) return false;
    if (reservation.estado === "LIBERADA") return reservation.operacionLiberacionId === input.operationId;

    const released = await transaction.reservaComercial.updateMany({
      where: { id: input.id, estado: "ACTIVA" },
      data: { estado: "LIBERADA", liberadaEn: new Date(), liberadaPorUsuarioId: input.userId, operacionLiberacionId: input.operationId },
    });
    if (!released.count) return false;
    await transaction.eventoAuditoria.createMany({
      data: [{
        operacionId: `reservation-release:${input.operationId}`,
        accion: "RESERVA_LIBERADA",
        usuarioId: input.userId,
        baseId: reservation.baseId,
        loteId: reservation.loteId,
        campana: reservation.campana,
        cantidad: 1,
        metadatos: { reservationId: reservation.id },
      }],
      skipDuplicates: true,
    });
    return true;
  });
}
