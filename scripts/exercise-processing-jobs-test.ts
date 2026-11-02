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

const {
  cancelProcessingJob,
  claimProcessingBlock,
  completeProcessingBlock,
  createProcessingJob,
  failProcessingBlock,
  getProcessingJob,
} = await import("../lib/server/processing-jobs-storage.ts");

const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: testUrl }) });
const testRunId = randomUUID();
const userId = randomUUID();
const createdJobIds: string[] = [];

function jobInput(operationId = randomUUID(), blocks = 1, maxAttempts = 3) {
  return { operationId, type: "IMPORTACION" as const, userId, blockCount: blocks, maxAttempts, metadata: { synthetic: true, testRunId } };
}

try {
  const identity = await prisma.$queryRaw<{ branch_id: string | null }[]>(Prisma.sql`SELECT current_setting('neon.branch_id', true) AS branch_id`);
  if (identity[0]?.branch_id !== expectedBranchId) throw new Error("Test branch identity mismatch.");
  await prisma.usuario.create({ data: { id: userId, username: `synthetic-processing-${testRunId}`, passwordHash: "synthetic-not-a-login-hash", activo: false } });

  const firstOperation = randomUUID();
  const first = await createProcessingJob(jobInput(firstOperation, 3));
  createdJobIds.push(first.job.id);
  const repeated = await createProcessingJob(jobInput(firstOperation, 3));
  if (first.reused || !repeated.reused || first.job.id !== repeated.job.id) throw new Error("Job creation was not idempotent.");

  let unauthorizedRejected = false;
  try { await getProcessingJob({ jobId: first.job.id, userId: randomUUID() }); } catch { unauthorizedRejected = true; }
  if (!unauthorizedRejected) throw new Error("An unrelated user could read a processing job.");

  const concurrent = await createProcessingJob(jobInput(randomUUID(), 1));
  createdJobIds.push(concurrent.job.id);
  const [claimA, claimB] = await Promise.all([
    claimProcessingBlock({ jobId: concurrent.job.id, userId, workerId: randomUUID(), leaseMs: 5_000 }),
    claimProcessingBlock({ jobId: concurrent.job.id, userId, workerId: randomUUID(), leaseMs: 5_000 }),
  ]);
  if (Number(Boolean(claimA)) + Number(Boolean(claimB)) !== 1) throw new Error("Concurrent workers claimed the same block.");

  const recovery = await createProcessingJob(jobInput(randomUUID(), 1));
  createdJobIds.push(recovery.job.id);
  const epoch = new Date("2026-11-01T12:00:00.000Z");
  const firstLease = await claimProcessingBlock({ jobId: recovery.job.id, userId, workerId: randomUUID(), leaseMs: 1_000, now: epoch });
  if (!firstLease) throw new Error("Initial lease was not claimed.");
  const recoveryWorker = randomUUID();
  const recovered = await claimProcessingBlock({ jobId: recovery.job.id, userId, workerId: recoveryWorker, leaseMs: 5_000, now: new Date(epoch.getTime() + 2_000) });
  if (!recovered || recovered.id !== firstLease.id || recovered.attempts !== 2) throw new Error("Expired lease was not recovered exactly once.");
  const recoveredSummary = await completeProcessingBlock({ jobId: recovery.job.id, blockId: recovered.id, userId, workerId: recoveryWorker, checkpoint: { cursor: 100 }, summary: { synthetic: true }, now: new Date(epoch.getTime() + 2_100) });
  if (recoveredSummary.state !== "COMPLETADO" || recoveredSummary.progressPercent !== 100) throw new Error("Checkpoint progress was not derived from the completed block.");
  if (await claimProcessingBlock({ jobId: recovery.job.id, userId, workerId: randomUUID(), leaseMs: 5_000 })) throw new Error("A completed job was reopened.");

  const retry = await createProcessingJob(jobInput(randomUUID(), 1, 2));
  createdJobIds.push(retry.job.id);
  const retryWorker = randomUUID();
  const retryFirst = await claimProcessingBlock({ jobId: retry.job.id, userId, workerId: retryWorker, leaseMs: 5_000 });
  if (!retryFirst) throw new Error("Retry fixture was not claimed.");
  const retryable = await failProcessingBlock({ jobId: retry.job.id, blockId: retryFirst.id, userId, workerId: retryWorker, errorCode: "SYNTHETIC_FAILURE" });
  if (retryable.state !== "RECUPERABLE") throw new Error("Retryable block did not preserve recovery state.");
  const retrySecondWorker = randomUUID();
  const retrySecond = await claimProcessingBlock({ jobId: retry.job.id, userId, workerId: retrySecondWorker, leaseMs: 5_000 });
  if (!retrySecond || retrySecond.attempts !== 2) throw new Error("Retry did not retain attempt count.");
  const retryFinished = await completeProcessingBlock({ jobId: retry.job.id, blockId: retrySecond.id, userId, workerId: retrySecondWorker });
  if (retryFinished.state !== "COMPLETADO") throw new Error("Retry completion did not finish the work.");

  const exhausted = await createProcessingJob(jobInput(randomUUID(), 1, 1));
  createdJobIds.push(exhausted.job.id);
  const exhaustedWorker = randomUUID();
  const exhaustedClaim = await claimProcessingBlock({ jobId: exhausted.job.id, userId, workerId: exhaustedWorker, leaseMs: 5_000 });
  if (!exhaustedClaim) throw new Error("Exhaustion fixture was not claimed.");
  const exhaustedResult = await failProcessingBlock({ jobId: exhausted.job.id, blockId: exhaustedClaim.id, userId, workerId: exhaustedWorker, errorCode: "SYNTHETIC_FAILURE" });
  if (exhaustedResult.state !== "FALLIDO" || exhaustedResult.failedBlocks !== 1) throw new Error("Retry limit did not close the work safely.");

  const cancellation = await createProcessingJob(jobInput(randomUUID(), 2));
  createdJobIds.push(cancellation.job.id);
  const cancelled = await cancelProcessingJob({ jobId: cancellation.job.id, userId });
  if (cancelled.state !== "CANCELADO" || await claimProcessingBlock({ jobId: cancellation.job.id, userId, workerId: randomUUID(), leaseMs: 5_000 })) throw new Error("Cancellation allowed further processing.");

  console.log(JSON.stringify({ target: "test", branchId: identity[0]?.branch_id, testRunId, idempotentCreation: true, concurrentSingleClaim: true, leaseRecovery: true, retry: true, completedNotReopened: true, cancellation: true, unauthorizedRejected: true }));
} finally {
  if (createdJobIds.length) {
    await prisma.archivoProcesamiento.deleteMany({ where: { trabajoId: { in: createdJobIds } } });
    await prisma.bloqueTrabajoProcesamiento.deleteMany({ where: { trabajoId: { in: createdJobIds } } });
    await prisma.trabajoProcesamiento.deleteMany({ where: { id: { in: createdJobIds } } });
  }
  await prisma.usuario.deleteMany({ where: { id: userId } });
  const residue = await prisma.trabajoProcesamiento.count({ where: { metadatos: { path: ["testRunId"], equals: testRunId } } });
  if (residue) throw new Error("Processing job fixtures were not cleaned.");
  await prisma.$disconnect();
}
