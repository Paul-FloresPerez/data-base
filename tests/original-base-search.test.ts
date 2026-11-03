import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { normalizeOriginalBaseSearch } from "../lib/base-history/original-base-search.ts";

test("normaliza acentos y mayúsculas para buscar código, nombre y archivo", () => {
  assert.equal(normalizeOriginalBaseSearch("  BÁSE  Ñandú "), "base nandu");
  assert.equal(normalizeOriginalBaseSearch("CRM_MARZO.xlsx"), "crm_marzo.xlsx");
});

test("la búsqueda de bases originales es paginada y no carga registros CRM", async () => {
  const storage = await readFile(new URL("../lib/server/base-storage.ts", import.meta.url), "utf8");
  assert.match(storage, /export async function searchOriginalBases/);
  assert.match(storage, /WHERE tipo = 'ORIGINAL'/);
  assert.match(storage, /LIMIT \$\{limit\} OFFSET \$\{offset\}/);
  assert.match(storage, /nombre_original/);
  const selectorSource = storage.slice(storage.indexOf("export async function searchOriginalBases"), storage.indexOf("export async function getSavedBase"));
  assert.doesNotMatch(selectorSource, /include:\s*\{\s*registros/);
});

test("el selector reutilizable conserva selección manual y ofrece resultados paginados por teclado", async () => {
  const selector = await readFile(new URL("../components/original-base-selector.tsx", import.meta.url), "utf8");
  const recycling = await readFile(new URL("../components/recycling-workspace-v2.tsx", import.meta.url), "utf8");
  assert.match(selector, /role="combobox"/);
  assert.match(selector, /ArrowDown/);
  assert.match(selector, /purpose: "original-selector"/);
  assert.match(selector, /Anterior/);
  assert.match(selector, /Siguiente/);
  assert.match(recycling, /setPreparedExecutionId\(null\)/);
  assert.match(recycling, /OriginalBaseSelector/);
});
