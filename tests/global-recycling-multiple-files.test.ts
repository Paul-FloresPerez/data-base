import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { analyzeRecyclingFiles } from "../lib/recycling/recycling.ts";

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
  assert.match(workspace, /!!issues\.length/);
  assert.match(workspace, /\.csv/);
  assert.match(fileRoute, /procedencia/);
  assert.match(storage, /source: input\.procedencia/);
});
