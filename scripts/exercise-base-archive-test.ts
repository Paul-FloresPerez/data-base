import { randomUUID } from "node:crypto";
import nextEnv from "@next/env";
import { Client } from "pg";

nextEnv.loadEnvConfig(process.cwd());
const url = process.env.PRISMA_MIGRATION_TEST_URL;
const expectedBranch = process.env.PRISMA_MIGRATION_TEST_BRANCH_ID;
if (!url || !expectedBranch) throw new Error("La conexión segura de Test no está configurada.");

const identity = new Client({ connectionString: url });
await identity.connect();
try {
  const result = await identity.query<{ branch_id: string | null }>("SELECT current_setting('neon.branch_id', true) AS branch_id");
  if (result.rows[0]?.branch_id !== expectedBranch) throw new Error("La identidad de Test no coincide.");
} finally { await identity.end(); }

process.env.DATABASE_URL = url;
process.env.DATABASE_URL_UNPOOLED = url;
const { prisma } = await import("../lib/server/prisma.ts");
const { archiveBase, getBaseAdministrativeDependencies, restoreArchivedBase } = await import("../lib/server/base-archive-storage.ts");

const testRunId = randomUUID();
const userId = randomUUID();
const baseId = randomUUID();
try {
  await prisma.usuario.create({ data: { id: userId, username: `synthetic-archive-${testRunId}`, passwordHash: "synthetic-not-a-login-hash", activo: true } });
  await prisma.base.create({ data: {
    id: baseId, codigo: `ARC-${testRunId.slice(0, 8)}`, nombreOriginal: "synthetic-archive.xlsx", nombreDescriptivo: "Base sintética archivada",
    tipo: "ORIGINAL", estado: "LISTA_PARA_DISTRIBUIR", cantidadImportados: 0, cantidadValidos: 0, cantidadExcluidos: 0,
    metadatos: { version: 1, completed: true, synthetic: true },
  } });
  const before = await getBaseAdministrativeDependencies(baseId);
  if (!before?.canPrepareControlledDeletion) throw new Error("La base sintética vacía tiene dependencias inesperadas.");
  const archived = await archiveBase({ baseId, userId, operationId: randomUUID(), reason: "Fixture sintético de archivado" });
  if (archived.reused) throw new Error("El primer archivado se reutilizó inesperadamente.");
  const during = await getBaseAdministrativeDependencies(baseId);
  if (!during?.archivedAt) throw new Error("El archivado lógico no quedó persistido.");
  const restored = await restoreArchivedBase({ baseId, userId, operationId: randomUUID() });
  if (restored.reused) throw new Error("La restauración se reutilizó inesperadamente.");
  const after = await getBaseAdministrativeDependencies(baseId);
  if (!after || after.archivedAt) throw new Error("La restauración lógica no quedó persistida.");
  console.log(JSON.stringify({ target: "test", branchId: expectedBranch, testRunId, archiveRestore: true, dependenciesChecked: true }));
} finally {
  await prisma.eventoAuditoria.deleteMany({ where: { baseId } });
  await prisma.base.deleteMany({ where: { id: baseId } });
  await prisma.usuario.deleteMany({ where: { id: userId } });
  await prisma.$disconnect();
}
