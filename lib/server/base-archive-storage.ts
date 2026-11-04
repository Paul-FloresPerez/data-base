import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { appendAdministrativeBaseEvent } from "@/lib/server/audit-storage";
import { prisma } from "@/lib/server/prisma";

function validReason(value: string) {
  const reason = value.trim();
  if (reason.length < 3 || reason.length > 500) throw new Error("El motivo de archivado no es válido.");
  return reason;
}

async function requireActiveUser(tx: Prisma.TransactionClient, userId: string) {
  const user = await tx.usuario.findUnique({ where: { id: userId }, select: { activo: true } });
  if (!user?.activo) throw new Error("El usuario administrador no está disponible.");
}

export async function getBaseAdministrativeDependencies(baseId: string) {
  const base = await prisma.base.findUnique({
    where: { id: baseId },
    select: {
      id: true, codigo: true, tipo: true, archivadaEn: true, motivoArchivado: true,
      _count: { select: {
        registros: true, lotes: true, reservasComerciales: true, archivosTipificaciones: true,
        asociacionesArchivosCrm: true, ejecucionesReciclaje: true, ejecucionesReciclajeGlobal: true,
        basesDerivadas: true, eventosAuditoria: true, exportaciones: true, trabajosProcesamiento: true,
      } },
    },
  });
  if (!base) return null;
  const activeReservations = await prisma.reservaComercial.count({ where: { baseId, estado: "ACTIVA" } });
  const dependencies = { ...base._count, activeReservations };
  const dependencyCount = Object.values(dependencies).reduce((total, value) => total + value, 0);
  return {
    id: base.id,
    code: base.codigo,
    kind: base.tipo,
    archivedAt: base.archivadaEn?.toISOString() ?? null,
    archiveReason: base.motivoArchivado,
    dependencies,
    canPrepareControlledDeletion: dependencyCount === 0,
    requiredAction: dependencyCount === 0 ? "ELIMINACION_CONTROLADA_FUTURA" : "ARCHIVADO_LOGICO",
  };
}

export async function archiveBase(input: { baseId: string; userId: string; operationId: string; reason: string }) {
  const reason = validReason(input.reason);
  return prisma.$transaction(async (tx) => {
    await requireActiveUser(tx, input.userId);
    const base = await tx.base.findUnique({ where: { id: input.baseId }, select: { id: true, archivadaEn: true } });
    if (!base) throw new Error("La base no existe.");
    if (!base.archivadaEn) {
      await tx.base.update({ where: { id: input.baseId }, data: { archivadaEn: new Date(), archivadaPorUsuarioId: input.userId, motivoArchivado: reason } });
    }
    await appendAdministrativeBaseEvent(tx, { operationId: `base-archive:${input.operationId}`, action: "BASE_ARCHIVADA", userId: input.userId, baseId: input.baseId, metadata: { reasonProvided: true } });
    return { archived: true, reused: Boolean(base.archivadaEn) };
  });
}

export async function restoreArchivedBase(input: { baseId: string; userId: string; operationId: string }) {
  return prisma.$transaction(async (tx) => {
    await requireActiveUser(tx, input.userId);
    const base = await tx.base.findUnique({ where: { id: input.baseId }, select: { id: true, archivadaEn: true } });
    if (!base) throw new Error("La base no existe.");
    if (base.archivadaEn) {
      await tx.base.update({ where: { id: input.baseId }, data: { archivadaEn: null, archivadaPorUsuarioId: null, motivoArchivado: null } });
    }
    await appendAdministrativeBaseEvent(tx, { operationId: `base-restore:${input.operationId}`, action: "BASE_RESTAURADA", userId: input.userId, baseId: input.baseId, metadata: {} });
    return { restored: true, reused: !base.archivadaEn };
  });
}
