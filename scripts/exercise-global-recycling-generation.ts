import { randomUUID } from "node:crypto";
import nextEnv from "@next/env";
import { Prisma, PrismaClient } from "../generated/prisma/client.ts";
import { PrismaNeon } from "@prisma/adapter-neon";
import { CRM_RECYCLING_HEADERS } from "../lib/export/crm-recycling-export.ts";

nextEnv.loadEnvConfig(process.cwd());
const url = process.env.PRISMA_MIGRATION_TEST_URL;
const expectedBranch = process.env.PRISMA_MIGRATION_TEST_BRANCH_ID;
if (!url || !expectedBranch) throw new Error("Dedicated Test configuration is required.");
process.env.DATABASE_URL = url;
const { createGlobalRecyclingExecution, evaluateGlobalRecyclingExecution, generateGlobalRecycledBase } = await import("../lib/server/global-recycling-storage.ts");
const db = new PrismaClient({ adapter: new PrismaNeon({ connectionString: url }) });
const run = randomUUID();
const ids = { user: randomUUID(), first: randomUUID(), second: randomUUID(), file: randomUUID(), importer: randomUUID(), lot: randomUUID() };
const mobiles = Array.from({ length: 7 }, (_, index) => `677${String(410000 + index).slice(-6)}`);
const metadata = { version: 1, completed: true, synthetic: true, testRunId: run, originalFileName: "synthetic.xlsx", columns: [...CRM_RECYCLING_HEADERS], enrichmentColumns: [...CRM_RECYCLING_HEADERS], columnMapping: { movil: 0, enriched: {} }, enrichmentMode: "preserve", campaignFilters: {}, distribution: { selectedCampaigns: [], batchSize: 100 } };
const criteria = { effectiveDate: "2026-11-01", recyclableTipifications: ["NO RESPONDE"], minimumMonths: 4, minimumDate: "2019-02-01" };
const cells = (mobile: string) => [mobile, "", "NO RESPONDE", "Vodafone", "Vodafone", "", "2026-01-01", "2026", "01", "01", "", "", "", "", "", "", "", "", "", "", "", "", "", ""];
try {
  const identity = await db.$queryRaw<{ branch_id: string | null }[]>(Prisma.sql`SELECT current_setting('neon.branch_id', true) AS branch_id`);
  if (identity[0]?.branch_id !== expectedBranch) throw new Error("Test branch identity mismatch.");
  await db.usuario.create({ data: { id: ids.user, username: `synthetic-rg4-${run}`, passwordHash: "synthetic", activo: true } });
  for (const index of [0, 1]) await db.base.upsert({ where: { id: index === 0 ? ids.first : ids.second }, create: { id: index === 0 ? ids.first : ids.second, codigo: `RG4-${run.slice(0, 6)}-${index === 0 ? "A" : "B"}`, nombreOriginal: "synthetic.xlsx", nombreDescriptivo: "RG4", tipo: "ORIGINAL", estado: "LISTA_PARA_DISTRIBUIR", cantidadImportados: index === 0 ? 6 : 2, cantidadValidos: index === 0 ? 6 : 2, cantidadExcluidos: 0, metadatos: metadata }, update: {} });
  await db.registro.createMany({ data: mobiles.slice(0, 6).map((mobile, index) => ({ baseId: ids.first, numeroFilaOriginal: index + 2, movilNormalizado: mobile, documento: `SYN-${index}`, nombre: `Synthetic ${index}`, operadorActual: "Vodafone", operadorOriginal: "Vodafone", fechaPortabilidad: new Date("2026-01-01T00:00:00.000Z"), tipificacion: "VALIDO", datosOriginales: { ...metadata, cells: cells(mobile), enrichedCells: cells(mobile), mobile, provenance: "API_REAL" } })) });
  await db.registro.createMany({ data: [mobiles[0], mobiles[6]].map((mobile, index) => ({ baseId: ids.second, numeroFilaOriginal: index + 2, movilNormalizado: mobile, documento: `SYN-${index === 0 ? 0 : 6}`, nombre: `Synthetic ${index === 0 ? 0 : 6}`, operadorActual: "Vodafone", operadorOriginal: "Vodafone", fechaPortabilidad: new Date("2026-01-01T00:00:00.000Z"), tipificacion: "VALIDO", datosOriginales: { ...metadata, cells: cells(mobile!), enrichedCells: cells(mobile!), mobile, provenance: "API_REAL" } })) });
  await db.archivoCrmCanonico.create({ data: { id: ids.file, importacionId: `rg4-file-${run}`, huellaContenido: `rg4${run.replaceAll("-", "")}`, nombreArchivo: "synthetic.xlsx", metadatos: metadata, filas: { create: mobiles.map((mobile, index) => ({ hojaOrigen: "Datos", numeroFilaOrigen: index + 2, movilNormalizado: mobile, fechaGestion: new Date("2026-10-01T00:00:00.000Z"), tipificacionOriginal: "NO RESPONDE", tipificacionNormalizada: "NO RESPONDE", ventaConfirmada: false, datosOriginales: metadata, metadatos: metadata })) } } });
  const execution = await createGlobalRecyclingExecution({ operationId: `rg4-${run}`, userId: ids.user, archivoCrmIds: [ids.file], criteria });
  await evaluateGlobalRecyclingExecution(execution.id);
  const importer = await db.importacionVentas.create({ data: { importacionId: `rg4-sale-${run}`, huellaContenido: `s${run.replaceAll("-", "")}`, usuarioId: ids.user, nombreArchivo: "synthetic.xlsx", resumen: metadata } });
  await db.ventaExterna.create({ data: { importacionId: importer.id, numeroFilaOrigen: 2, movilNormalizado: mobiles[1]!, estado: "CONFIRMADA", resultadoConciliacion: "SINTETICO", metadatos: metadata } });
  await db.lote.create({ data: { id: ids.lot, baseId: ids.first, baseOriginalId: ids.first, campana: "YOIGO", numeroLote: 1, cantidadRegistros: 1 } });
  await db.reservaComercial.create({ data: { movilNormalizado: mobiles[2]!, baseId: ids.first, loteId: ids.lot, campana: "YOIGO", usuarioId: ids.user, operacionId: `rg4-res-${run}`, metadatos: metadata } });
  const results = await Promise.allSettled([generateGlobalRecycledBase({ executionId: execution.id, userId: ids.user }), generateGlobalRecycledBase({ executionId: execution.id, userId: ids.user })]);
  const success = results.filter((result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof generateGlobalRecycledBase>>> => result.status === "fulfilled");
  if (!success.length || !success[0]!.value.baseId) throw new Error("Global generation did not persist a base.");
  const baseId = success[0]!.value.baseId;
  const [base, outcomes] = await Promise.all([db.base.findUniqueOrThrow({ where: { id: baseId }, include: { registros: true } }), db.resultadoGeneracionReciclajeGlobal.findMany({ where: { ejecucionId: execution.id } })]);
  if (base.registros.length !== 5 || outcomes.filter((row) => row.estado === "EXCLUIDO_CAMBIO").length !== 2 || new Set(base.registros.map((record) => record.movilNormalizado)).size !== 5) throw new Error("Revalidation or mobile consolidation failed.");
  if (!base.registros.every((record) => Array.isArray((record.datosOriginales as { cells?: unknown }).cells) && ((record.datosOriginales as { cells: unknown[] }).cells).length === 24)) throw new Error("Generated records do not preserve the CRM export contract.");
  console.log(JSON.stringify({ target: "test", testRunId: run, eligible: 7, included: 5, excludedChanged: 2, concurrentSingleBase: true, crmHeaders: 24, fixturesCleaned: true }));
} finally {
  const executions = await db.ejecucionReciclajeGlobal.findMany({ where: { operacionId: `rg4-${run}` }, select: { id: true, baseRecicladaId: true } });
  const executionIds = executions.map((row) => row.id); const generated = executions.flatMap((row) => row.baseRecicladaId ? [row.baseRecicladaId] : []);
  if (generated.length) await db.eventoAuditoria.deleteMany({ where: { baseId: { in: generated } } });
  if (executionIds.length) await db.resultadoGeneracionReciclajeGlobal.deleteMany({ where: { ejecucionId: { in: executionIds } } });
  if (executionIds.length) await db.decisionEjecucionReciclajeGlobal.deleteMany({ where: { ejecucionId: { in: executionIds } } });
  if (executionIds.length) await db.ejecucionReciclajeGlobalBase.deleteMany({ where: { ejecucionId: { in: executionIds } } });
  if (executionIds.length) await db.ejecucionReciclajeGlobalArchivo.deleteMany({ where: { ejecucionId: { in: executionIds } } });
  if (executionIds.length) await db.ejecucionReciclajeGlobal.deleteMany({ where: { id: { in: executionIds } } });
  if (generated.length) await db.base.deleteMany({ where: { id: { in: generated } } });
  await db.reservaComercial.deleteMany({ where: { loteId: ids.lot } }); await db.lote.deleteMany({ where: { id: ids.lot } });
  const imports = await db.importacionVentas.findMany({ where: { importacionId: `rg4-sale-${run}` }, select: { id: true } });
  if (imports.length) { await db.ventaExterna.deleteMany({ where: { importacionId: { in: imports.map((row) => row.id) } } }); await db.importacionVentas.deleteMany({ where: { id: { in: imports.map((row) => row.id) } } }); }
  await db.filaArchivoCrm.deleteMany({ where: { archivoCrmId: ids.file } }); await db.archivoCrmCanonico.deleteMany({ where: { id: ids.file } }); await db.base.deleteMany({ where: { id: { in: [ids.first, ids.second] } } }); await db.usuario.deleteMany({ where: { id: ids.user } }); await db.$disconnect();
}
