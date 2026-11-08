import "server-only";

import { Prisma } from "@/generated/prisma/client";

type Transaction = Parameters<Parameters<typeof import("@/lib/server/prisma").prisma.$transaction>[0]>[0];

/** PostgreSQL transaction-scoped locks; sorted keys prevent deadlocks. */
export async function lockCommercialMobiles(transaction: Transaction, mobiles: readonly string[]) {
  const ordered = [...new Set(mobiles)].sort();
  if (!ordered.length) return;
  // PostgreSQL evaluates this ordered source before taking each transaction
  // advisory lock. One query avoids a network round trip per mobile while the
  // deterministic order preserves the deadlock discipline for concurrent
  // distributions and recycling transitions.
  await transaction.$executeRaw(Prisma.sql`
    SELECT pg_advisory_xact_lock(hashtextextended(movil, 0))
    FROM unnest(ARRAY[${Prisma.join(ordered)}]::text[]) AS locks(movil)
    ORDER BY movil
  `);
}
