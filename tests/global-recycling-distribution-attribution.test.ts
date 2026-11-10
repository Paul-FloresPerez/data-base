import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("la evaluación global congela la atribución de lote sin usar el nombre CRM", async () => {
  const [storage, route, workspace] = await Promise.all([
    readFile(new URL("../lib/server/global-recycling-storage.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/reciclaje-global/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../components/global-recycling-workspace.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(storage, /prisma\.loteRegistro\.findMany/);
  assert.match(storage, /registroId: \{ in: records\.map/);
  assert.match(storage, /atribucionDistribucion/);
  assert.match(storage, /SIN_DISTRIBUCION_HISTORICA/);
  assert.match(storage, /VERIFICADA/);
  assert.match(storage, /AMBIGUA/);
  assert.match(storage, /globalRecyclingExecutionId/);
  assert.doesNotMatch(storage, /nombreArchivo.*lote|lote.*nombreArchivo/i);
  assert.match(route, /baseOriginalId/);
  assert.match(workspace, /Filtrar por base ORIGINAL/);
  assert.match(workspace, /baseOriginalId: baseOriginalId \|\| undefined/);
});
