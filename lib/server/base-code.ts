import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { formatBaseCode } from "@/lib/base-history/catalog";

/**
 * Allocates a durable, human-readable base code within the current database
 * transaction. Keeping this here lets every server-side base creator use the
 * same sequence without exposing it to client code.
 */
export async function nextBaseCode(transaction: Prisma.TransactionClient, receivedAt: Date | null): Promise<string> {
  const date = receivedAt ?? new Date();
  const period = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
  const rows = await transaction.$queryRaw<Array<{ ultimo_numero: number }>>(Prisma.sql`
    INSERT INTO "secuencias_codigos_base" ("periodo", "ultimo_numero") VALUES (${period}, 1)
    ON CONFLICT ("periodo") DO UPDATE SET "ultimo_numero" = "secuencias_codigos_base"."ultimo_numero" + 1
    RETURNING "ultimo_numero"
  `);
  const sequence = rows[0]?.ultimo_numero;
  if (!sequence) throw new Error("No se pudo generar el código de la base.");
  return formatBaseCode(date, sequence);
}
