import { randomUUID } from "node:crypto";
import nextEnv from "@next/env";
import { PrismaNeon } from "@prisma/adapter-neon";
import { Prisma, PrismaClient } from "../generated/prisma/client.ts";
import type { SaveStartPayload } from "../lib/persistence/workspace-persistence.ts";

nextEnv.loadEnvConfig(process.cwd());

const testUrl = process.env.PRISMA_MIGRATION_TEST_URL;
const expectedBranchId = process.env.PRISMA_MIGRATION_TEST_BRANCH_ID;
if (!testUrl || !expectedBranchId) throw new Error("Dedicated Test configuration is required.");
process.env.DATABASE_URL = testUrl;
process.env.DATABASE_URL_UNPOOLED = testUrl;

const { beginBaseSave, completeBaseSave } = await import("../lib/server/base-storage.ts");
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: testUrl }) });
const testRunId = randomUUID();
const userId = randomUUID();
const baseId = randomUUID();
const revision = randomUUID();
const rowCount = 9_999;
const seed = Number.parseInt(testRunId.replaceAll("-", "").slice(0, 6), 16) % 8_000_000;

function mobile(index: number): string {
  return `6${String(10_000_000 + seed + index).padStart(8, "0")}`;
}

const payload: SaveStartPayload = {
  id: baseId,
  name: "Synthetic pre-enriched ORIGINAL",
  revision,
  expectedRecords: rowCount,
  validRecords: rowCount,
  excludedRecords: 0,
  state: "LISTA_PARA_DISTRIBUIR",
  receivedAt: null,
  originalBaseId: null,
  metadata: {
    version: 1,
    completed: false,
    revision: null,
    originalFileName: `synthetic-pre-enriched-${testRunId}.xlsx`,
    columns: ["Teléfono Movil", "Operador Actual", "Operador Original", "Fecha Portabilidad"],
    columnMapping: { movil: 0, enriched: { operador_actual: 1, operador_origen: 2, fecha_portabilidad: 3 } },
    enrichmentColumns: ["Teléfono Movil", "Operador Actual", "Operador Original", "Fecha Portabilidad"],
    enrichmentMode: "preserve",
    campaignFilters: {},
    distribution: { batchSize: 100, selectedCampaigns: ["vodafone"], shuffleSeed: baseId },
    enrichmentSource: "excel",
    kind: "ORIGINAL",
    importMode: "YA_ENRIQUECIDA",
    testRunId,
  },
};

try {
  console.log(JSON.stringify({ target: "test", testRunId, phase: "starting" }));
  const identity = await prisma.$queryRaw<{ branch_id: string | null }[]>(Prisma.sql`SELECT current_setting('neon.branch_id', true) AS branch_id`);
  if (identity[0]?.branch_id !== expectedBranchId) throw new Error("Test branch identity mismatch.");
  await prisma.usuario.create({ data: { id: userId, username: `synthetic-enriched-${testRunId}`, passwordHash: "synthetic-not-a-login-hash", activo: false } });
  await beginBaseSave(payload);
  await prisma.registro.createMany({ data: Array.from({ length: rowCount }, (_, index) => {
    const value = mobile(index);
    return {
      baseId,
      numeroFilaOriginal: index + 2,
      movilNormalizado: value,
      operadorActual: "Orange",
      operadorOriginal: "Vodafone",
      fechaPortabilidad: new Date("2024-01-02T00:00:00.000Z"),
      tipificacion: "VALIDO" as const,
      datosOriginales: { version: 1, cells: [value, "Orange", "Vodafone", "2024-01-02"], mobile: value, contactPhone: "", reason: null, enrichedCells: [value, "Orange", "Vodafone", "2024-01-02"], provenance: "EXCEL" },
    };
  }) });
  const completed = await completeBaseSave(baseId, revision, [], userId);
  const [base, recordCount, sample, lots, reservations] = await Promise.all([
    prisma.base.findUniqueOrThrow({ where: { id: baseId }, select: { estado: true, metadatos: true } }),
    prisma.registro.count({ where: { baseId } }),
    prisma.registro.findFirstOrThrow({ where: { baseId }, select: { datosOriginales: true } }),
    prisma.lote.count({ where: { baseId } }),
    prisma.reservaComercial.count({ where: { baseId } }),
  ]);
  const metadata = base.metadatos as { completed?: boolean; importMode?: string; enrichmentSource?: string };
  const original = sample.datosOriginales as { provenance?: unknown };
  if (!completed || base.estado !== "LISTA_PARA_DISTRIBUIR" || !metadata.completed || metadata.importMode !== "YA_ENRIQUECIDA" || metadata.enrichmentSource !== "excel" || recordCount !== rowCount || original.provenance !== "EXCEL" || lots !== 0 || reservations !== 0) {
    throw new Error("Pre-enriched import did not preserve its verified state.");
  }
  console.log(JSON.stringify({ target: "test", expectedBranchId, testRunId, rowsPersisted: rowCount, provenance: "EXCEL", completedWithoutLots: true, lots, reservations, sozarCalls: 0 }));
} finally {
  const auditIds = (await prisma.eventoAuditoria.findMany({ where: { baseId, usuarioId: userId }, select: { id: true } })).map((item) => item.id);
  if (auditIds.length) await prisma.eventoAuditoria.deleteMany({ where: { id: { in: auditIds } } });
  await prisma.base.deleteMany({ where: { id: baseId } });
  await prisma.usuario.deleteMany({ where: { id: userId } });
  const [bases, users] = await Promise.all([prisma.base.count({ where: { id: baseId } }), prisma.usuario.count({ where: { id: userId } })]);
  if (bases || users) throw new Error("Synthetic pre-enriched fixture cleanup was incomplete.");
  await prisma.$disconnect();
}
