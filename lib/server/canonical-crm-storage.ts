import "server-only";

import type { Prisma, PrismaClient } from "../../generated/prisma/client.ts";

type CanonicalCrmClient = PrismaClient | Prisma.TransactionClient;

export type CanonicalCrmAssociationInput = {
  archivoCrmId: string;
  baseOriginalId: string;
  resumenConciliacion?: Prisma.InputJsonValue;
  metadatos: Prisma.InputJsonValue;
};

/**
 * The persistence boundary for RG-1. It deliberately only establishes an
 * idempotent Archivo CRM -> Base ORIGINAL association; RG-2 will perform the
 * global reconciliation itself.
 */
export async function associateCanonicalCrmFile(
  client: CanonicalCrmClient,
  input: CanonicalCrmAssociationInput,
) {
  const [archivo, base] = await Promise.all([
    client.archivoCrmCanonico.findUnique({
      where: { id: input.archivoCrmId },
      select: { id: true },
    }),
    client.base.findUnique({
      where: { id: input.baseOriginalId },
      select: { id: true, tipo: true },
    }),
  ]);

  if (!archivo) throw new Error("El archivo CRM canónico no existe.");
  if (!base) throw new Error("La base original seleccionada no existe.");
  if (base.tipo !== "ORIGINAL") {
    throw new Error("Un archivo CRM solo puede asociarse a una base ORIGINAL.");
  }

  return client.archivoCrmBase.upsert({
    where: {
      archivoCrmId_baseOriginalId: {
        archivoCrmId: input.archivoCrmId,
        baseOriginalId: input.baseOriginalId,
      },
    },
    create: {
      archivoCrmId: input.archivoCrmId,
      baseOriginalId: input.baseOriginalId,
      resumenConciliacion: input.resumenConciliacion,
      metadatos: input.metadatos,
    },
    update: {},
  });
}
