import { randomUUID } from "node:crypto";
import nextEnv from "@next/env";
import { PrismaNeon } from "@prisma/adapter-neon";
import { Prisma, PrismaClient } from "../generated/prisma/client.ts";

nextEnv.loadEnvConfig(process.cwd());
const testUrl = process.env.PRISMA_MIGRATION_TEST_URL;
const expectedBranchId = process.env.PRISMA_MIGRATION_TEST_BRANCH_ID;
if (!testUrl || !expectedBranchId) throw new Error("Dedicated Test configuration is required.");
process.env.DATABASE_URL = testUrl;
process.env.DATABASE_URL_UNPOOLED = testUrl;

const { searchOriginalBases } = await import("../lib/server/base-storage.ts");
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: testUrl }) });
const testRunId = randomUUID();
const ids = Array.from({ length: 4 }, () => randomUUID());

function metadata() { return { version: 1, completed: true, testRunId, originalFileName: "fixture.xlsx", columns: ["Teléfono Movil"], enrichmentColumns: [], columnMapping: { movil: 0, enriched: {} }, distribution: { batchSize: 100, selectedCampaigns: [] } }; }

try {
  const identity = await prisma.$queryRaw<{ branch_id: string | null }[]>(Prisma.sql`SELECT current_setting('neon.branch_id', true) AS branch_id`);
  if (identity[0]?.branch_id !== expectedBranchId) throw new Error("Test branch identity mismatch.");
  await prisma.base.createMany({ data: [
    { id: ids[0]!, codigo: `BUS-${testRunId.slice(0, 8)}-01`, nombreOriginal: "CRM_MARZO.xlsx", nombreDescriptivo: "Base Ávila Marzo", tipo: "ORIGINAL", estado: "LISTA_PARA_DISTRIBUIR", cantidadImportados: 11, cantidadValidos: 11, cantidadExcluidos: 0, metadatos: metadata() },
    { id: ids[1]!, codigo: `BUS-${testRunId.slice(0, 8)}-02`, nombreOriginal: "CRM_ABRIL.xlsx", nombreDescriptivo: "Base Avila Abril", tipo: "ORIGINAL", estado: "LISTA_PARA_ENRIQUECER", cantidadImportados: 12, cantidadValidos: 12, cantidadExcluidos: 0, metadatos: metadata() },
    { id: ids[2]!, codigo: `BUS-${testRunId.slice(0, 8)}-03`, nombreOriginal: "GESTIONES_MAYO.xlsx", nombreDescriptivo: "Base Norte", tipo: "ORIGINAL", estado: "LISTA_PARA_DISTRIBUIR", cantidadImportados: 13, cantidadValidos: 13, cantidadExcluidos: 0, metadatos: metadata() },
  ] });
  await prisma.base.create({ data: { id: ids[3]!, codigo: `BUS-${testRunId.slice(0, 8)}-04`, nombreOriginal: "RECICLADA.xlsx", nombreDescriptivo: "Base Ávila reciclada", tipo: "RECICLADA", baseOriginalId: ids[0]!, estado: "LISTA_PARA_DISTRIBUIR", cantidadImportados: 1, cantidadValidos: 1, cantidadExcluidos: 0, metadatos: metadata() } });
  const byCode = await searchOriginalBases({ query: `bus-${testRunId.slice(0, 8)}-01`, page: 0, limit: 12 });
  const byAccent = await searchOriginalBases({ query: "avila", page: 0, limit: 12 });
  const byFile = await searchOriginalBases({ query: "gestiones_mayo", page: 0, limit: 12 });
  const paged = await searchOriginalBases({ query: `bus-${testRunId.slice(0, 8)}`, page: 0, limit: 2 });
  if (byCode.bases.length !== 1 || byCode.bases[0]?.id !== ids[0] || byAccent.bases.length !== 2 || byAccent.bases.some((base) => base.kind !== "ORIGINAL") || byFile.bases[0]?.id !== ids[2] || paged.bases.length !== 2 || paged.total !== 3) throw new Error("Original-base search did not honor matching, type filtering, or pagination.");
  console.log(JSON.stringify({ target: "test", testRunId, codeSearch: true, accentSearch: true, filenameSearch: true, pagination: true, recordsSelected: 0 }));
} finally {
  await prisma.base.deleteMany({ where: { id: ids[3] } });
  await prisma.base.deleteMany({ where: { id: { in: ids.slice(0, 3) } } });
  const remaining = await prisma.base.count({ where: { id: { in: ids } } });
  if (remaining) throw new Error("Synthetic search fixture cleanup was incomplete.");
  await prisma.$disconnect();
}
