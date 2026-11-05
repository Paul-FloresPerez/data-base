import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { streamCsvRows } from "../lib/import/incremental-csv.ts";

async function* chunks(values: string[]) {
  const encoder = new TextEncoder();
  for (const value of values) yield encoder.encode(value);
}

test("lee CSV progresivamente entre límites de chunk, comillas y codificación BOM", async () => {
  const rows: string[][] = [];
  for await (const row of streamCsvRows(chunks(["\uFEFFTeléfono Movil;Nombres\r", "\n612345678;\"Ana; Mar", "ía\"\n712345678;Luis\n"]), ";")) rows.push(row);
  assert.deepEqual(rows, [["Teléfono Movil", "Nombres"], ["612345678", "Ana; María"], ["712345678", "Luis"]]);
});

test("el flujo incremental utiliza trabajos existentes, checkpoints y no declara soporte XLSX progresivo", async () => {
  const [service, parser, schema] = await Promise.all([
    readFile(new URL("../lib/server/incremental-import-storage.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/import/incremental-csv.ts", import.meta.url), "utf8"),
    readFile(new URL("../prisma/schema.prisma", import.meta.url), "utf8"),
  ]);
  assert.match(service, /createProcessingJob|trabajoProcesamiento\.create/);
  assert.match(service, /claimProcessingBlock/);
  assert.match(service, /completeProcessingBlock/);
  assert.match(service, /archivoProcesamientoId/);
  assert.match(service, /No se puede finalizar una base con filas faltantes/);
  assert.match(parser, /AsyncIterable<Uint8Array>/);
  assert.doesNotMatch(parser, /xlsx/i);
  assert.match(schema, /archivoProcesamientoId\s+String\?/);
  assert.match(schema, /numeroFilaArchivo\s+Int\?/);
});
