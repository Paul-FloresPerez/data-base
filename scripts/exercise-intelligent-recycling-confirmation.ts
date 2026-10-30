import { randomUUID } from "node:crypto";
import nextEnv from "@next/env";
import { PrismaNeon } from "@prisma/adapter-neon";
import { PrismaClient } from "../generated/prisma/client.ts";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const connectionString = process.env.DATABASE_URL_AUDIT_TEST_UNPOOLED;
const expectedBranchId = "br-fragrant-heart-b5nue1w1";
if (!connectionString) throw new Error("DATABASE_URL_AUDIT_TEST_UNPOOLED is required.");

const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString }) });
const prefix = `recycling-confirmation-test-${randomUUID()}`;

try {
  const branch = await prisma.$queryRaw<Array<{ branch_id: string | null }>>`SELECT current_setting('neon.branch_id', true) AS branch_id`;
  if (branch[0]?.branch_id !== expectedBranchId) throw new Error("The isolated Test branch identity did not match.");
  const user = await prisma.usuario.findFirst({ select: { id: true } });
  if (!user) throw new Error("The isolated Test branch requires an existing test user.");

  const original = await prisma.base.create({
    data: {
      codigo: `${prefix}-original`,
      nombreOriginal: "fixture-original.xlsx",
      nombreDescriptivo: "Fixture original",
      tipo: "ORIGINAL",
      estado: "LISTA_PARA_DISTRIBUIR",
      cantidadImportados: 2,
      cantidadValidos: 2,
      cantidadExcluidos: 0,
      metadatos: { version: 1, completed: true, originalFileName: "fixture-original.xlsx", columns: ["Teléfono Movil"], enrichmentColumns: ["Teléfono Movil"], columnMapping: {}, distribution: { batchSize: 100, selectedCampaigns: [] } },
    },
  });
  const records = await prisma.registro.createManyAndReturn({
    data: [1, 2].map((numeroFilaOriginal) => ({ baseId: original.id, numeroFilaOriginal, movilNormalizado: `6${String(numeroFilaOriginal).padStart(8, "0")}`, tipificacion: "VALIDO", datosOriginales: { version: 1, cells: [`6${String(numeroFilaOriginal).padStart(8, "0")}`] } })),
    select: { id: true },
  });
  const execution = await prisma.ejecucionReciclaje.create({
    data: {
      operacionId: `${prefix}:operation`,
      baseOriginalId: original.id,
      usuarioId: user.id,
      fechaEfectiva: new Date("2026-10-29T00:00:00.000Z"),
      estado: "EVALUADA",
      metadatos: { version: 1, summary: { ELEGIBLE: 2 } },
    },
  });
  await prisma.resultadoEjecucionReciclaje.createMany({
    data: records.map((record) => ({ ejecucionId: execution.id, registroOriginalId: record.id, estado: "ELEGIBLE", motivo: "Fixture elegible" })),
  });

  const confirm = () => prisma.$transaction(async (transaction) => {
    const claimed = await transaction.ejecucionReciclaje.updateMany({ where: { id: execution.id, estado: "EVALUADA", baseRecicladaId: null }, data: { estado: "EVALUANDO" } });
    if (!claimed.count) {
      const current = await transaction.ejecucionReciclaje.findUniqueOrThrow({ where: { id: execution.id }, select: { baseRecicladaId: true, estado: true } });
      if (current.estado === "BASE_GENERADA" && current.baseRecicladaId) return current.baseRecicladaId;
      throw new Error("The confirmation claim was not idempotent.");
    }
    const recycled = await transaction.base.create({
      data: {
        codigo: `${prefix}-recycled`, nombreOriginal: "RECICLADA_fixture-original.xlsx", nombreDescriptivo: "Fixture reciclada", tipo: "RECICLADA", baseOriginalId: original.id,
        estado: "LISTA_PARA_DISTRIBUIR", cantidadImportados: 2, cantidadValidos: 2, cantidadExcluidos: 0,
        metadatos: { version: 1, completed: true, originalFileName: "RECICLADA_fixture-original.xlsx", columns: ["Teléfono Movil"], enrichmentColumns: ["Teléfono Movil"], columnMapping: {}, distribution: { batchSize: 100, selectedCampaigns: [] }, recyclingExecutionId: execution.id },
      },
      select: { id: true },
    });
    await transaction.ejecucionReciclaje.update({ where: { id: execution.id }, data: { baseRecicladaId: recycled.id, estado: "BASE_GENERADA" } });
    return recycled.id;
  });

  const attempts = await Promise.allSettled([confirm(), confirm()]);
  const successful = attempts.filter((attempt) => attempt.status === "fulfilled").map((attempt) => (attempt as PromiseFulfilledResult<string>).value);
  if (successful.length !== 2 || new Set(successful).size !== 1) throw new Error("Concurrent confirmation did not resolve to one recycled base.");
  const persisted = await prisma.ejecucionReciclaje.findUniqueOrThrow({ where: { id: execution.id }, select: { estado: true, baseRecicladaId: true } });
  const derived = await prisma.base.count({ where: { baseOriginalId: original.id, tipo: "RECICLADA" } });
  if (persisted.estado !== "BASE_GENERADA" || !persisted.baseRecicladaId || derived !== 1) throw new Error("The recycling execution was not persisted atomically.");
  console.log(JSON.stringify({ branchId: expectedBranchId, concurrentConfirmations: successful.length, derivedBases: derived, providerCalls: 0, verified: true }));
} finally {
  const execution = await prisma.ejecucionReciclaje.findFirst({ where: { operacionId: `${prefix}:operation` }, select: { id: true, baseOriginalId: true, baseRecicladaId: true } });
  if (execution) {
    await prisma.resultadoEjecucionReciclaje.deleteMany({ where: { ejecucionId: execution.id } });
    await prisma.ejecucionReciclaje.delete({ where: { id: execution.id } });
    if (execution.baseRecicladaId) await prisma.base.delete({ where: { id: execution.baseRecicladaId } });
    await prisma.base.delete({ where: { id: execution.baseOriginalId } });
  }
  await prisma.$disconnect();
}
