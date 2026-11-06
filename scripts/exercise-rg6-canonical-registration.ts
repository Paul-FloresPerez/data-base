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

const { appendCanonicalCrmRows, conciliateCanonicalCrmFile, createCanonicalCrmFile } = await import("../lib/server/global-crm-conciliation-storage.ts");
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: testUrl }) });
const testRunId = randomUUID();
const baseId = randomUUID();
const matchingImportId = randomUUID();
const unmatchedImportId = randomUUID();
const fingerprint = (seed: string) => `${seed}${testRunId.replaceAll("-", "")}`.padEnd(64, "a").slice(0, 64);
const metadata = { synthetic: true, testRunId, completed: true };
const matchingMobiles = Array.from({ length: 100 }, (_, index) => `612${String(index).padStart(6, "0")}`);
const unmatchedMobiles = Array.from({ length: 100 }, (_, index) => `712${String(index).padStart(6, "0")}`);

async function createAndAppend(importacionId: string, huellaContenido: string, mobiles: readonly string[]) {
  const input = { importacionId, huellaContenido, nombreArchivo: `synthetic-rg6-${testRunId}.xlsx`, headers: ["Telefono Movil", "Tipificacion"], procedencia: { zipName: null, internalPath: null } };
  const first = await createCanonicalCrmFile(input);
  const repeated = await createCanonicalCrmFile(input);
  if (first.id !== repeated.id || !repeated.reused) throw new Error("Canonical file reimport was not idempotent.");
  const rows = mobiles.map((movil, index) => ({ hoja: "Datos", fila: index + 2, movil, fechaGestion: "2026-01-01", tipificacion: "NO RESPONDE", ventaConfirmada: false, evidenciaVenta: null, cells: [movil, "NO RESPONDE"] }));
  await appendCanonicalCrmRows({ archivoCrmId: first.id, rows });
  await appendCanonicalCrmRows({ archivoCrmId: first.id, rows });
  const persisted = await prisma.filaArchivoCrm.count({ where: { archivoCrmId: first.id } });
  if (persisted !== 100) throw new Error("Canonical row reimport created duplicates.");
  return first.id;
}

try {
  const identity = await prisma.$queryRaw<{ branch_id: string | null }[]>(Prisma.sql`SELECT current_setting('neon.branch_id', true) AS branch_id`);
  if (identity[0]?.branch_id !== expectedBranchId) throw new Error("Test branch identity mismatch.");
  await prisma.base.create({ data: {
    id: baseId, codigo: `RG6-${baseId.slice(0, 8)}`, nombreOriginal: `synthetic-rg6-${testRunId}.xlsx`, nombreDescriptivo: "RG-6 registration", estado: "LISTA_PARA_DISTRIBUIR", cantidadImportados: 100, cantidadValidos: 100, cantidadExcluidos: 0, metadatos: metadata,
    registros: { create: matchingMobiles.map((movil, index) => ({ numeroFilaOriginal: index + 2, movilNormalizado: movil, tipificacion: "VALIDO", datosOriginales: metadata })) },
  } });
  const matchingFileId = await createAndAppend(matchingImportId, fingerprint("1"), matchingMobiles);
  const unmatchedFileId = await createAndAppend(unmatchedImportId, fingerprint("2"), unmatchedMobiles);
  const [matching, unmatched] = await Promise.all([
    conciliateCanonicalCrmFile({ archivoCrmId: matchingFileId, pageSize: 25 }),
    conciliateCanonicalCrmFile({ archivoCrmId: unmatchedFileId, pageSize: 25 }),
  ]);
  if (matching.logicalMobiles !== 100 || matching.unmatched !== 0 || matching.associatedBases !== 1 || unmatched.logicalMobiles !== 100 || unmatched.unmatched !== 100 || unmatched.associatedBases !== 0) throw new Error("RG-6 positive or zero-match reconciliation is incorrect.");
  console.log(JSON.stringify({ target: "test", testRunId, directXlsxNullProvenance: true, reimportIdempotent: true, matchingMobiles: 100, unmatchedMobiles: 100, fixturesCleaned: true }));
} finally {
  const files = await prisma.archivoCrmCanonico.findMany({ where: { importacionId: { in: [matchingImportId, unmatchedImportId] } }, select: { id: true } });
  const fileIds = files.map((file) => file.id);
  await prisma.archivoCrmBase.deleteMany({ where: { archivoCrmId: { in: fileIds } } });
  await prisma.filaArchivoCrm.deleteMany({ where: { archivoCrmId: { in: fileIds } } });
  await prisma.archivoCrmCanonico.deleteMany({ where: { id: { in: fileIds } } });
  await prisma.base.deleteMany({ where: { id: baseId } });
  const residue = await prisma.archivoCrmCanonico.count({ where: { importacionId: { in: [matchingImportId, unmatchedImportId] } } });
  if (residue) throw new Error("RG-6 fixture cleanup was incomplete.");
  await prisma.$disconnect();
}
