import nextEnv from "@next/env";
import { PrismaNeon } from "@prisma/adapter-neon";
import { Prisma, PrismaClient } from "../generated/prisma/client.ts";

nextEnv.loadEnvConfig(process.cwd());
const connectionString = process.env.PRISMA_MIGRATION_TEST_URL;
const expectedBranchId = process.env.PRISMA_MIGRATION_TEST_BRANCH_ID;
if (!connectionString || !expectedBranchId) throw new Error("Dedicated Test migration configuration is required.");

const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString }) });
try {
  const identity = await prisma.$queryRaw<{ branch_id: string | null }[]>(Prisma.sql`SELECT current_setting('neon.branch_id', true) AS branch_id`);
  if (identity[0]?.branch_id !== expectedBranchId) throw new Error("Test branch identity mismatch.");
  const imports = await prisma.importacionVentas.findMany({
    where: { resumen: { path: ["synthetic"], equals: true }, usuario: { username: { startsWith: "synthetic-sales-" } } },
    select: { id: true, usuarioId: true, eventos: { select: { id: true, movilNormalizado: true, metadatos: true } }, usuario: { select: { username: true } } },
  });
  const fixtures = imports.filter((item) => item.eventos.every((event) => event.movilNormalizado === "612345678" && (event.metadatos as { synthetic?: unknown }).synthetic === true));
  console.log(JSON.stringify({ target: "test", branchId: identity[0]?.branch_id, matchedImports: fixtures.map((item) => ({ importId: item.id, userId: item.usuarioId, eventIds: item.eventos.map((event) => event.id) })), unequivocal: fixtures.length === 1 }));
} finally {
  await prisma.$disconnect();
}
