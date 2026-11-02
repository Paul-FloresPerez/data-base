import "server-only";

import { Prisma, type Campana } from "@/generated/prisma/client";
import { prisma } from "@/lib/server/prisma";

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

/** Releases a hold explicitly; the historical reservation is never deleted. */
export async function releaseCommercialReservation(input: { id: string; userId: string; operationId: string }) {
  return prisma.$transaction(async (transaction) => {
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
