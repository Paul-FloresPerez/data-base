import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { analyzeRecyclingFiles } from "../lib/recycling/recycling.ts";
import { parseCanonicalCrmFileRequest } from "../lib/recycling/canonical-crm-request.ts";

const canonicalRequest = (procedencia: unknown) => ({
  importacionId: "aaaaaaaa-aaaa-5aaa-8aaa-aaaaaaaaaaaa",
  huellaContenido: "a".repeat(64),
  nombreArchivo: "crm.xlsx",
  headers: ["Telefono Movil", "Tipificacion"],
  procedencia,
});

test("acepta procedencia nula de un XLSX directo y conserva la de ZIP", () => {
  assert.deepEqual(parseCanonicalCrmFileRequest(canonicalRequest({ zipName: null, internalPath: null }))?.procedencia, { zipName: null, internalPath: null });
  assert.deepEqual(parseCanonicalCrmFileRequest(canonicalRequest({ zipName: "lote.zip", internalPath: "octubre/crm.xlsx" }))?.procedencia, { zipName: "lote.zip", internalPath: "octubre/crm.xlsx" });
  assert.equal(parseCanonicalCrmFileRequest(canonicalRequest({ zipName: 3, internalPath: null })), null);
});

test("la consolidación local conserva tres procedencias de un mismo móvil", () => {
  const analysis = analyzeRecyclingFiles([
    { fileName: "enero.xlsx", columns: ["Fecha", "Teléfono Movil", "Tipificación"], rows: [["2026-01-01", "612345678", "NO RESPONDE"]] },
    { fileName: "febrero.csv", columns: ["Fecha", "Teléfono Movil", "Tipificación"], rows: [["2026-02-01", "612345678", "AGENDADO"]] },
    { fileName: "marzo.xlsx", zipName: "crm.zip", internalPath: "marzo/marzo.xlsx", columns: ["Fecha", "Teléfono Movil", "Tipificación"], rows: [["2026-03-01", "612345678", "CORTA LLAMADA"]] },
  ]);
  assert.equal(analysis.counts.moviles, 1);
  assert.equal(analysis.counts.duplicados, 2);
  assert.deepEqual(analysis.records.map((row) => [row.fileName, row.zipName ?? null, row.internalPath ?? null]), [["enero.xlsx", null, null], ["febrero.csv", null, null], ["marzo.xlsx", "crm.zip", "marzo/marzo.xlsx"]]);
});

test("RG-6 registra todas las fuentes, bloquea conciliación parcial y reutiliza el ZIP seguro", async () => {
  const [workspace, fileRoute, storage] = await Promise.all([
    readFile(new URL("../components/global-recycling-workspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/reciclaje-global/archivos/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/server/global-crm-conciliation-storage.ts", import.meta.url), "utf8"),
  ]);
  assert.match(workspace, /multiple/);
  assert.match(workspace, /extractArchiveWorkbooks/);
  assert.match(workspace, /importIdFromFingerprint/);
  assert.match(workspace, /archivoCrmIds:\s*fileIds/);
  assert.match(workspace, /const singleSource = results\.length === 1/);
  assert.match(workspace, /setSummary\(singleSource/);
  assert.match(workspace, /!!issues\.length/);
  assert.match(workspace, /\.csv/);
  assert.match(workspace, /No se pudo registrar \$\{registering\.fileName\}/);
  assert.match(fileRoute, /parseCanonicalCrmFileRequest/);
  assert.match(storage, /source: input\.procedencia/);
});
