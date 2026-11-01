import "server-only";

import { Prisma } from "@/generated/prisma/client";

type Transaction = Parameters<Parameters<typeof import("@/lib/server/prisma").prisma.$transaction>[0]>[0];

/** PostgreSQL transaction-scoped locks; sorted keys prevent deadlocks. */
export async function lockCommercialMobiles(transaction: Transaction, mobiles: readonly string[]) {
  for (const mobile of [...new Set(mobiles)].sort()) {
    await transaction.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${mobile}, 0))`);
  }
}
