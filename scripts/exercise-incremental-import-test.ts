import { createHash, randomUUID } from "node:crypto";
import nextEnv from "@next/env";
import { PrismaNeon } from "@prisma/adapter-neon";
import { Prisma, PrismaClient } from "../generated/prisma/client.ts";

nextEnv.loadEnvConfig(process.cwd());
const testUrl = process.env.PRISMA_MIGRATION_TEST_URL;
const expectedBranch = process.env.PRISMA_MIGRATION_TEST_BRANCH_ID;
if (!testUrl || !expectedBranch) throw new Error("Dedicated Test configuration is required.");
process.env.DATABASE_URL = testUrl;
process.env.DATABASE_URL_UNPOOLED = testUrl;

const { claimIncrementalCsvBlock, createIncrementalCsvImport, finalizeIncrementalCsvImport, persistIncrementalCsvBlock } = await import("../lib/server/incremental-import-storage.ts");
const { failProcessingBlock } = await import("../lib/server/processing-jobs-storage.ts");
const { getSavedBase } = await import("../lib/server/base-storage.ts");

const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: testUrl }) });
const testRunId = randomUUID();
const userId = randomUUID();
const baseId = randomUUID();
let jobId: string | null = null;
const startedAt = performance.now();
let persistenceMs = 0;
let persistedBlocks = 0;
const headers = ["Teléfono Movil", "Nombres", "Numero Doc"];
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

function mobileFor(globalIndex: number) { return `6${String(globalIndex).padStart(8, "0")}`; }
function rowsFor(claim: { source: { originalName: string }; firstRow: number; rowCount: number; globalFirstRow: number }) {
  return Array.from({ length: claim.rowCount }, (_, index) => {
    const globalIndex = claim.globalFirstRow + index - 2;
    let mobile = mobileFor(globalIndex);
    if (claim.source.originalName === "fuente-a.csv" && globalIndex === 1) mobile = "912345678";
    if (claim.source.originalName === "fuente-b.csv" && globalIndex === 6_000) mobile = mobileFor(0);
    return { sourceRow: claim.firstRow + index, cells: [mobile, `Nombre ${globalIndex}`, String(globalIndex).padStart(8, "0")] };
  });
}

async function persistBlock(input: Parameters<typeof persistIncrementalCsvBlock>[0]) {
  const started = performance.now();
  const result = await persistIncrementalCsvBlock(input);
  persistenceMs += performance.now() - started;
  persistedBlocks += 1;
  return result;
}

try {
  const identity = await prisma.$queryRaw<{ branch_id: string | null }[]>(Prisma.sql`SELECT current_setting('neon.branch_id', true) AS branch_id`);
  if (identity[0]?.branch_id !== expectedBranch) throw new Error("Test branch identity mismatch.");
  await prisma.usuario.create({ data: { id: userId, username: `synthetic-incremental-${testRunId}`, passwordHash: "synthetic-not-a-login-hash", activo: true } });
  const created = await createIncrementalCsvImport({ operationId: randomUUID(), baseId, userId, name: "Base incremental sintética", blockSize: 4_000, sources: [
    { originalName: "fuente-a.csv", contentHash: hash(`${testRunId}:a`), privateReference: `synthetic://${testRunId}/a`, bytes: 1, totalRows: 6_000, headers },
    { originalName: "fuente-b.csv", contentHash: hash(`${testRunId}:b`), privateReference: `synthetic://${testRunId}/b`, bytes: 1, totalRows: 4_000, headers },
  ] });
  const activeJobId = created.jobId;
  jobId = activeJobId;
  console.log(JSON.stringify({ target: "test", testRunId, phase: "created" }));
  if (await getSavedBase(baseId)) throw new Error("Una base incompleta no debe estar disponible para reciclaje o biblioteca.");
  const repeat = await createIncrementalCsvImport({ operationId: (await prisma.trabajoProcesamiento.findUniqueOrThrow({ where: { id: activeJobId }, select: { operacionId: true } })).operacionId, baseId, userId, name: "Base incremental sintética", blockSize: 4_000, sources: [
    { originalName: "fuente-a.csv", contentHash: hash(`${testRunId}:a`), privateReference: `synthetic://${testRunId}/a`, bytes: 1, totalRows: 6_000, headers },
    { originalName: "fuente-b.csv", contentHash: hash(`${testRunId}:b`), privateReference: `synthetic://${testRunId}/b`, bytes: 1, totalRows: 4_000, headers },
  ] });
  if (!repeat.reused || repeat.jobId !== activeJobId) throw new Error("La creación no fue idempotente.");

  const firstWorker = randomUUID();
  const secondWorker = randomUUID();
  const [first, second] = await Promise.all([
    claimIncrementalCsvBlock({ jobId: activeJobId, userId, workerId: firstWorker, leaseMs: 60_000 }),
    claimIncrementalCsvBlock({ jobId: activeJobId, userId, workerId: secondWorker, leaseMs: 60_000 }),
  ]);
  if (!first || !second || first.number === second.number) throw new Error("Los workers no reclamaron bloques distintos.");
  await Promise.all([
    persistBlock({ jobId: activeJobId, blockId: first.id, userId, workerId: firstWorker, fileId: first.source.id, blockNumber: first.number, rows: rowsFor(first) }),
    persistBlock({ jobId: activeJobId, blockId: second.id, userId, workerId: secondWorker, fileId: second.source.id, blockNumber: second.number, rows: rowsFor(second) }),
  ]);
  console.log(JSON.stringify({ target: "test", testRunId, phase: "concurrent-blocks-completed" }));

  const interruptedWorker = randomUUID();
  const interrupted = await claimIncrementalCsvBlock({ jobId: activeJobId, userId, workerId: interruptedWorker, leaseMs: 60_000 });
  if (!interrupted) throw new Error("No se pudo preparar el bloque recuperable.");
  await failProcessingBlock({ jobId: activeJobId, blockId: interrupted.id, userId, workerId: interruptedWorker, errorCode: "SYNTHETIC_INTERRUPTION" });
  const recoveredWorker = randomUUID();
  const recovered = await claimIncrementalCsvBlock({ jobId: activeJobId, userId, workerId: recoveredWorker, leaseMs: 60_000 });
  if (!recovered || recovered.number !== interrupted.number || recovered.attempts !== 2) throw new Error("El bloque interrumpido no se recuperó correctamente.");
  await persistBlock({ jobId: activeJobId, blockId: recovered.id, userId, workerId: recoveredWorker, fileId: recovered.source.id, blockNumber: recovered.number, rows: rowsFor(recovered) });
  console.log(JSON.stringify({ target: "test", testRunId, phase: "recovered" }));

  while (true) {
    const workerId = randomUUID();
    const claim = await claimIncrementalCsvBlock({ jobId: activeJobId, userId, workerId, leaseMs: 60_000 });
    if (!claim) break;
    await persistBlock({ jobId: activeJobId, blockId: claim.id, userId, workerId, fileId: claim.source.id, blockNumber: claim.number, rows: rowsFor(claim) });
  }
  const final = await finalizeIncrementalCsvImport({ jobId: activeJobId, userId });
  if (final.imported !== 10_000 || final.valid !== 9_998 || final.excluded !== 2) throw new Error("Los contadores incrementales no coincidieron.");
  const stored = await getSavedBase(baseId);
  if (!stored || stored.records.length !== 10_000) throw new Error("La base terminada no es recuperable desde Mis bases.");
  const sourceFiles = await prisma.registro.groupBy({ by: ["archivoProcesamientoId"], where: { baseId }, _count: true });
  if (sourceFiles.length !== 2 || sourceFiles.some((entry) => entry._count === 0)) throw new Error("La procedencia de archivos no quedó preservada.");
  const elapsedMs = performance.now() - startedAt;
  console.log(JSON.stringify({ target: "test", branchId: expectedBranch, testRunId, records: 10_000, blockSize: 4_000, blocks: 3, recovered: true, concurrentDistinctClaims: true, valid: final.valid, excluded: final.excluded, elapsedMs: Math.round(elapsedMs), recordsPerSecond: Math.round(10_000 / (elapsedMs / 1_000)), persistenceMs: Math.round(persistenceMs), averagePersistenceMs: Math.round(persistenceMs / persistedBlocks), peakRssBytes: process.memoryUsage().rss }));
} finally {
  if (jobId) {
    await prisma.registro.deleteMany({ where: { baseId } });
    await prisma.archivoProcesamiento.deleteMany({ where: { trabajoId: jobId } });
    await prisma.bloqueTrabajoProcesamiento.deleteMany({ where: { trabajoId: jobId } });
    await prisma.trabajoProcesamiento.deleteMany({ where: { id: jobId } });
  }
  await prisma.base.deleteMany({ where: { id: baseId } });
  await prisma.usuario.deleteMany({ where: { id: userId } });
  await prisma.$disconnect();
}
