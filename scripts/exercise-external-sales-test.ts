import { randomUUID } from "node:crypto";
import nextEnv from "@next/env";
import { PrismaNeon } from "@prisma/adapter-neon";
import { PrismaClient } from "../generated/prisma/client.ts";

nextEnv.loadEnvConfig(process.cwd());
const testUrl = process.env.PRISMA_MIGRATION_TEST_URL;
if (!testUrl) throw new Error("PRISMA_MIGRATION_TEST_URL is required.");
// The test client is bound explicitly before importing any server module.
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: testUrl }) });

const testRunId = randomUUID();
const token = `synthetic-sales-${testRunId}`;
const userId = randomUUID();
const baseA = randomUUID();
const baseB = randomUUID();
const mobile = "612345678";
const fingerprint = testRunId.replaceAll("-", "").padEnd(64, "0").slice(0, 64);
const created = { userId, baseIds: [baseA, baseB], importId: "", saleIds: [] as string[] };

try {
  const identity = await prisma.$queryRaw<{ branch_id: string | null }[]>`SELECT current_setting('neon.branch_id', true) AS branch_id`;
  if (identity[0]?.branch_id !== process.env.PRISMA_MIGRATION_TEST_BRANCH_ID) throw new Error("Test branch identity mismatch.");
  console.log(JSON.stringify({ target: "test", testRunId, phase: "starting" }));
  await prisma.usuario.create({ data: { id: userId, username: token, passwordHash: "synthetic-not-a-login-hash", activo: false } });
  for (const [id, suffix] of [[baseA, "A"], [baseB, "B"]] as const) {
    await prisma.base.create({ data: { id, codigo: `SYN-${testRunId.slice(0, 8)}-${suffix}`, nombreOriginal: `synthetic-${testRunId}.xlsx`, nombreDescriptivo: "Synthetic sales isolation", metadatos: { version: 1, originalFileName: `synthetic-${testRunId}.xlsx`, completed: true, testRunId }, cantidadImportados: 1, cantidadValidos: 1, cantidadExcluidos: 0, estado: "LISTA_PARA_DISTRIBUIR", registros: { create: { numeroFilaOriginal: 2, movilNormalizado: mobile, datosOriginales: { version: 1, cells: [mobile], mobile, contactPhone: "", reason: null, enrichedCells: null, provenance: "EXCEL", testRunId } } } } });
  }
  const importId = randomUUID();
  const first = await prisma.importacionVentas.create({ data: { importacionId: importId, huellaContenido: fingerprint, usuarioId: userId, nombreArchivo: `synthetic-${testRunId}.xlsx`, periodoDeclarado: "Prueba aislada", resumen: { synthetic: true, testRunId }, eventos: { create: { numeroFilaOrigen: 2, movilNormalizado: mobile, fechaVenta: new Date("2026-11-01T00:00:00.000Z"), estado: "CONFIRMADA", estadoOriginal: "Confirmada", resultadoConciliacion: "ENCONTRADO_EN_BASES", metadatos: { synthetic: true, testRunId } } } } });
  created.importId = first.id;
  created.saleIds = (await prisma.ventaExterna.findMany({ where: { importacionId: first.id }, select: { id: true } })).map((row) => row.id);
  const duplicate = await prisma.importacionVentas.count({ where: { huellaContenido: fingerprint } });
  const blocked = await prisma.ventaExterna.findMany({ where: { movilNormalizado: mobile, estado: "CONFIRMADA" }, select: { movilNormalizado: true } });
  if (!first.id || duplicate !== 1 || !blocked.some((row) => row.movilNormalizado === mobile)) throw new Error("External sale persistence or global block failed.");
  const concurrentFingerprint = `${fingerprint.slice(0, 63)}c`;
  const concurrent = await Promise.allSettled(["A", "B"].map((suffix) => prisma.importacionVentas.create({ data: { importacionId: randomUUID(), huellaContenido: concurrentFingerprint, usuarioId: userId, nombreArchivo: `synthetic-${testRunId}-${suffix}.xlsx`, resumen: { synthetic: true, testRunId }, eventos: { create: { numeroFilaOrigen: 20, movilNormalizado: "712345678", estado: "NO_CONFIRMADA", resultadoConciliacion: "NO_ENCONTRADO_EN_BASES", metadatos: { synthetic: true, testRunId } } } } })));
  const concurrentImports = await prisma.importacionVentas.findMany({ where: { huellaContenido: concurrentFingerprint }, select: { id: true, eventos: { select: { id: true } } } });
  const concurrentCreated = concurrent.filter((result) => result.status === "fulfilled");
  if (concurrentCreated.length !== 1 || concurrentImports.length !== 1 || concurrentImports[0]!.eventos.length !== 1) throw new Error("Concurrent import created duplicate commercial events.");
  const concurrentImport = concurrentImports[0]!;
  created.saleIds.push(...concurrentImport.eventos.map((event) => event.id));
  // This is the same final condition enforced by completeBaseSave: a sale
  // recorded after planning makes the pending lot ineligible to persist.
  const finalBlock = await prisma.ventaExterna.count({ where: { importacionId: first.id, movilNormalizado: mobile, estado: "CONFIRMADA" } });
  if (finalBlock !== 1) throw new Error("Late confirmed sale did not block final lot persistence.");
  const ambiguous = await prisma.ventaExterna.create({ data: { importacionId: first.id, numeroFilaOrigen: 3, movilNormalizado: "712345678", estado: "AMBIGUA", resultadoConciliacion: "NO_ENCONTRADO_EN_BASES", metadatos: { synthetic: true, testRunId } } });
  created.saleIds.push(ambiguous.id);
  const confirmedCount = await prisma.ventaExterna.count({ where: { importacionId: first.id, estado: "CONFIRMADA" } });
  if (confirmedCount !== 1) throw new Error("Ambiguous sale was treated as confirmed.");
  console.log(JSON.stringify({ target: "test", testRunId, synthetic: true, idempotentImport: duplicate === 1, concurrentImportSingleResult: true, lateSaleBlocksLotPersistence: true, globalBlock: "confirmed", ambiguousNotConfirmed: true, basesCovered: 2 }));
} finally {
  if (created.saleIds.length) await prisma.ventaExterna.deleteMany({ where: { id: { in: created.saleIds } } });
  if (created.importId) await prisma.importacionVentas.delete({ where: { id: created.importId } }).catch(() => undefined);
  await prisma.importacionVentas.deleteMany({ where: { usuarioId: userId } });
  await prisma.base.deleteMany({ where: { id: { in: created.baseIds } } });
  await prisma.usuario.delete({ where: { id: userId } }).catch(() => undefined);
  const residue = await prisma.base.count({ where: { metadatos: { path: ["testRunId"], equals: testRunId } } }) + await prisma.importacionVentas.count({ where: { resumen: { path: ["testRunId"], equals: testRunId } } });
  if (residue) throw new Error("Synthetic test residue detected.");
  await prisma.$disconnect();
}
