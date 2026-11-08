import nextEnv from "@next/env";
import { Prisma, PrismaClient } from "../generated/prisma/client.ts";
import { PrismaNeon } from "@prisma/adapter-neon";

nextEnv.loadEnvConfig(process.cwd());
const testUrl = process.env.PRISMA_MIGRATION_TEST_URL;
const expectedBranchId = process.env.PRISMA_MIGRATION_TEST_BRANCH_ID;
const testRunId = process.env.RECYCLING_TRANSITION_TEST_RUN_ID;
if (!testUrl || !expectedBranchId || !testRunId || !/^[0-9a-f-]{36}$/i.test(testRunId)) throw new Error("Dedicated Test configuration and an exact testRunId are required.");
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: testUrl }) });

try {
  const identity = await prisma.$queryRaw<{ branch_id: string | null }[]>(Prisma.sql`SELECT current_setting('neon.branch_id', true) AS branch_id`);
  if (identity[0]?.branch_id !== expectedBranchId) throw new Error("Test branch identity mismatch.");
  const bases = await prisma.base.findMany({ where: { metadatos: { path: ["testRunId"], equals: testRunId } }, select: { id: true } });
  const baseIds = bases.map((base) => base.id);
  const executions = await prisma.ejecucionReciclajeGlobal.findMany({ where: { criterios: { path: ["testRunId"], equals: testRunId } }, select: { id: true } });
  const executionIds = executions.map((execution) => execution.id);
  const users = await prisma.usuario.findMany({ where: { username: `synthetic-transition-${testRunId}` }, select: { id: true } });
  const userIds = users.map((user) => user.id);
  if (baseIds.length) await prisma.eventoAuditoria.deleteMany({ where: { baseId: { in: baseIds } } });
  if (baseIds.length) await prisma.reservaComercial.deleteMany({ where: { baseId: { in: baseIds } } });
  if (executionIds.length) await prisma.decisionEjecucionReciclajeGlobal.deleteMany({ where: { ejecucionId: { in: executionIds } } });
  if (executionIds.length) await prisma.ejecucionReciclajeGlobal.deleteMany({ where: { id: { in: executionIds } } });
  if (baseIds.length) await prisma.base.deleteMany({ where: { id: { in: baseIds } } });
  if (userIds.length) await prisma.usuario.deleteMany({ where: { id: { in: userIds } } });
  const [remainingBases, remainingExecutions, remainingUsers] = await Promise.all([
    prisma.base.count({ where: { id: { in: baseIds } } }),
    prisma.ejecucionReciclajeGlobal.count({ where: { id: { in: executionIds } } }),
    prisma.usuario.count({ where: { id: { in: userIds } } }),
  ]);
  if (remainingBases || remainingExecutions || remainingUsers) throw new Error("Exact transition fixture cleanup was incomplete.");
  console.log(JSON.stringify({ target: "test", testRunId, cleaned: { bases: baseIds.length, executions: executionIds.length, users: userIds.length } }));
} finally {
  await prisma.$disconnect();
}
