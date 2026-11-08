import { randomUUID } from "node:crypto";
import nextEnv from "@next/env";
import { Prisma, PrismaClient } from "../generated/prisma/client.ts";
import { PrismaNeon } from "@prisma/adapter-neon";

nextEnv.loadEnvConfig(process.cwd());
const url = process.env.PRISMA_MIGRATION_TEST_URL;
const branch = process.env.PRISMA_MIGRATION_TEST_BRANCH_ID;
if (!url || !branch) throw new Error("Dedicated Test configuration is required.");
process.env.DATABASE_URL = url;
const { createGlobalRecyclingExecution, evaluateGlobalRecyclingExecution } = await import("../lib/server/global-recycling-storage.ts");
const db = new PrismaClient({ adapter: new PrismaNeon({ connectionString: url }) });
const run = randomUUID();
const ids = { user: randomUUID(), a: randomUUID(), b: randomUUID(), file: randomUUID(), legacy: randomUUID(), lot: randomUUID() };
const mobiles = Array.from({ length: 10 }, (_, i) => `612200${String(i + 1).padStart(3, "0")}`);
const meta = { synthetic: true, testRunId: run, completed: true };
const criteria = { effectiveDate: "2026-08-01", recyclableTipifications: ["NO RESPONDE", "BUZÓN DE VOZ"], minimumMonths: 4, minimumDate: "2019-02-01" };
const base = (id: string, count: number) => ({ id, codigo: `RG3-${id.slice(0, 8)}`, nombreOriginal: `synthetic-${run}.xlsx`, nombreDescriptivo: "RG3", estado: "LISTA_PARA_DISTRIBUIR" as const, cantidadImportados: count, cantidadValidos: count, cantidadExcluidos: 0, metadatos: meta });
const rec = (row: number, mobile: string, x: Record<string, unknown> = {}) => ({ numeroFilaOriginal: row, movilNormalizado: mobile, documento: `D-${mobile}`, nombre: "Persona Sintética", operadorActual: "Vodafone", fechaPortabilidad: new Date("2026-01-01T00:00:00.000Z"), tipificacion: "VALIDO" as const, datosOriginales: { ...meta, provenance: "API_REAL" }, ...x });
const crmRow = (i: number, mobile: string, tip: string | null, x: Record<string, unknown> = {}) => ({ hojaOrigen: "Datos", numeroFilaOrigen: i + 2, movilNormalizado: mobile, fechaGestion: tip ? new Date("2026-07-01T00:00:00.000Z") : null, tipificacionOriginal: tip, tipificacionNormalizada: tip, ventaConfirmada: false, datosOriginales: meta, metadatos: meta, ...x });
try {
  const identity = await db.$queryRaw<{ branch_id: string | null }[]>(Prisma.sql`SELECT current_setting('neon.branch_id', true) AS branch_id`);
  if (identity[0]?.branch_id !== branch) throw new Error("Test branch identity mismatch.");
  await db.usuario.create({ data: { id: ids.user, username: `synthetic-rg3-${run}`, passwordHash: "synthetic", activo: true } });
  await db.base.create({ data: { ...base(ids.a, 10), registros: { create: [
    rec(2, mobiles[0]!), rec(3, mobiles[1]!), rec(4, mobiles[2]!), rec(5, mobiles[3]!), rec(6, mobiles[4]!, { fechaPortabilidad: new Date("2026-04-20T00:00:00.000Z") }), rec(7, mobiles[5]!), rec(8, mobiles[6]!, { fechaPortabilidad: null }), rec(9, mobiles[7]!, { datosOriginales: { ...meta, provenance: "MOCK" } }),
    rec(10, mobiles[8]!), rec(11, mobiles[9]!),
  ] } } });
  await db.base.create({ data: { ...base(ids.b, 2), registros: { create: [rec(2, mobiles[0]!), rec(3, mobiles[1]!, { documento: "CONFLICT", operadorActual: "Orange" })] } } });
  await db.lote.create({ data: { id: ids.lot, baseId: ids.a, baseOriginalId: ids.a, campana: "YOIGO", numeroLote: 1, cantidadRegistros: 1 } });
  await db.reservaComercial.create({ data: { movilNormalizado: mobiles[3]!, baseId: ids.a, loteId: ids.lot, campana: "YOIGO", usuarioId: ids.user, operacionId: `rg3-res-${run}`, metadatos: meta } });
  const saleImport = await db.importacionVentas.create({ data: { importacionId: `rg3-sale-${run}`, huellaContenido: `h${run.replaceAll("-", "")}`, usuarioId: ids.user, nombreArchivo: "synthetic.xlsx", resumen: meta } });
  await db.ventaExterna.create({ data: { importacionId: saleImport.id, numeroFilaOrigen: 2, movilNormalizado: mobiles[2]!, estado: "CONFIRMADA", resultadoConciliacion: "SINTETICO", metadatos: meta } });
  await db.archivoTipificaciones.create({ data: { id: ids.legacy, importacionId: `rg3-legacy-${run}`, baseId: ids.a, nombreArchivo: "legacy.xlsx", resumen: meta } });
  await db.gestionTipificacion.createMany({ data: [
    { archivoId: ids.legacy, baseOriginalId: ids.a, numeroFilaOrigen: 2, movilNormalizado: mobiles[0]!, fechaGestion: new Date("2026-07-01T00:00:00.000Z"), tipificacionOriginal: "NO RESPONDE", metadatos: meta },
    { archivoId: ids.legacy, baseOriginalId: ids.a, numeroFilaOrigen: 10, movilNormalizado: mobiles[8]!, fechaGestion: new Date("2026-07-01T00:00:00.000Z"), tipificacionOriginal: "BUZÓN DE VOZ", metadatos: meta },
  ] });
  await db.archivoCrmCanonico.create({ data: { id: ids.file, importacionId: `rg3-file-${run}`, huellaContenido: `f${run.replaceAll("-", "")}`, nombreArchivo: "synthetic.xlsx", archivoTipificacionesLegacyId: ids.legacy, metadatos: meta, filas: { create: mobiles.map((mobile, i) => crmRow(i, mobile, i === 0 ? "AGENDADO" : i === 5 ? "OTRA" : i === 6 ? null : i === 8 ? "INTERESADO" : i === 9 ? "NO CONTACTAR" : "NO RESPONDE")) } } });
  const created = await createGlobalRecyclingExecution({ operationId: `rg3-op-${run}`, userId: ids.user, archivoCrmIds: [ids.file], criteria });
  const repeated = await createGlobalRecyclingExecution({ operationId: `rg3-op-${run}`, userId: ids.user, archivoCrmIds: [ids.file], criteria });
  if (created.reused || !repeated.reused || created.id !== repeated.id) throw new Error("Execution creation is not idempotent.");
  await Promise.all([evaluateGlobalRecyclingExecution(created.id), evaluateGlobalRecyclingExecution(created.id)]);
  const decisions = await db.decisionEjecucionReciclajeGlobal.findMany({ where: { ejecucionId: created.id }, select: { movilNormalizado: true, decision: true, motivo: true, fuentes: true } });
  const count = decisions.reduce<Record<string, number>>((a, x) => ({ ...a, [x.decision]: (a[x.decision] ?? 0) + 1 }), {});
  const reasons = decisions.reduce<Record<string, number>>((a, x) => ({ ...a, [x.motivo]: (a[x.motivo] ?? 0) + 1 }), {});
  if (decisions.length !== 10 || count.ELEGIBLE !== 2 || count.EXCLUIDO !== 1 || count.BLOQUEADO !== 1 || count.REVISION !== 6 || !decisions.every((d) => Array.isArray((d.fuentes as { records?: unknown }).records))) throw new Error(`Global decisions are not complete: ${JSON.stringify({ count, reasons })}`);
  await db.ventaExterna.create({ data: { importacionId: saleImport.id, numeroFilaOrigen: 3, movilNormalizado: mobiles[0]!, estado: "CONFIRMADA", resultadoConciliacion: "SINTETICO", metadatos: meta } });
  const next = await createGlobalRecyclingExecution({ operationId: `rg3-next-${run}`, userId: ids.user, archivoCrmIds: [ids.file], criteria });
  await evaluateGlobalRecyclingExecution(next.id);
  const [oldD, nextD] = await Promise.all([
    db.decisionEjecucionReciclajeGlobal.findUniqueOrThrow({ where: { ejecucionId_movilNormalizado: { ejecucionId: created.id, movilNormalizado: mobiles[0]! } } }),
    db.decisionEjecucionReciclajeGlobal.findUniqueOrThrow({ where: { ejecucionId_movilNormalizado: { ejecucionId: next.id, movilNormalizado: mobiles[0]! } } }),
  ]);
  if (oldD.decision !== "ELEGIBLE" || nextD.decision !== "BLOQUEADO") throw new Error("Historical snapshot changed during reevaluation.");
  if (await db.gestionTipificacion.count({ where: { archivoId: ids.legacy } }) !== 2) throw new Error("Legacy history was modified.");
  console.log(JSON.stringify({ target: "test", testRunId: run, decisions: 10, idempotent: true, concurrent: true, historicalAgendadoAndInteresado: true, snapshotsImmutable: true, fixturesCleaned: true }));
} finally {
  const ex = await db.ejecucionReciclajeGlobal.findMany({ where: { operacionId: { in: [`rg3-op-${run}`, `rg3-next-${run}`] } }, select: { id: true } }); const eids = ex.map((x) => x.id);
  if (eids.length) await db.decisionEjecucionReciclajeGlobal.deleteMany({ where: { ejecucionId: { in: eids } } });
  if (eids.length) await db.ejecucionReciclajeGlobalBase.deleteMany({ where: { ejecucionId: { in: eids } } });
  if (eids.length) await db.ejecucionReciclajeGlobalArchivo.deleteMany({ where: { ejecucionId: { in: eids } } });
  if (eids.length) await db.ejecucionReciclajeGlobal.deleteMany({ where: { id: { in: eids } } });
  await db.reservaComercial.deleteMany({ where: { baseId: ids.a } }); await db.lote.deleteMany({ where: { id: ids.lot } });
  const sales = await db.importacionVentas.findMany({ where: { importacionId: `rg3-sale-${run}` }, select: { id: true } }); if (sales.length) { await db.ventaExterna.deleteMany({ where: { importacionId: { in: sales.map((x) => x.id) } } }); await db.importacionVentas.deleteMany({ where: { id: { in: sales.map((x) => x.id) } } }); }
  await db.filaArchivoCrm.deleteMany({ where: { archivoCrmId: ids.file } }); await db.archivoCrmCanonico.deleteMany({ where: { id: ids.file } }); await db.gestionTipificacion.deleteMany({ where: { archivoId: ids.legacy } }); await db.archivoTipificaciones.deleteMany({ where: { id: ids.legacy } }); await db.base.deleteMany({ where: { id: { in: [ids.a, ids.b] } } }); await db.usuario.deleteMany({ where: { id: ids.user } }); await db.$disconnect();
}
