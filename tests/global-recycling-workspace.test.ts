import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("RG-5 conecta archivo canónico, conciliación global y generación protegida", async () => {
  const [
    workspace,
    fileRoute,
    rowsRoute,
    conciliationRoute,
    executionRoute,
    evaluateRoute,
    exportRoute,
    storage,
  ] = await Promise.all([
    readFile(
      new URL("../components/global-recycling-workspace.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../app/api/reciclaje-global/archivos/route.ts", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL(
        "../app/api/reciclaje-global/archivos/[fileId]/filas/route.ts",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL(
        "../app/api/reciclaje-global/archivos/[fileId]/conciliar/route.ts",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL("../app/api/reciclaje-global/route.ts", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL(
        "../app/api/reciclaje-global/[executionId]/evaluar/route.ts",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL(
        "../app/api/reciclaje-global/[executionId]/descargar/route.ts",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL(
        "../lib/server/global-crm-conciliation-storage.ts",
        import.meta.url,
      ),
      "utf8",
    ),
  ]);
  for (const route of [
    fileRoute,
    rowsRoute,
    conciliationRoute,
    executionRoute,
    evaluateRoute,
    exportRoute,
  ])
    assert.match(route, /requireAdminApi/);
  assert.match(workspace, /Registrar archivo/);
  assert.match(workspace, /Comprobar contra bases activas/);
  assert.match(workspace, /Las tipificaciones incluidas definen candidatos CRM/);
  assert.match(workspace, /Incluidas:/);
  assert.match(workspace, /Excluidas:/);
  assert.match(workspace, /Candidatos por tipificación/);
  assert.match(workspace, /!selected\.size/);
  assert.match(workspace, /Generar base reciclada/);
  assert.match(workspace, /Descargar XLSX CRM/);
  assert.match(workspace, /summary\.logicalMobiles/);
  assert.match(workspace, /ventaConfirmada/);
  assert.match(workspace, /i\s*\+=\s*100/);
  assert.match(storage, /normalizeSpanishMobile/);
  assert.match(storage, /skipDuplicates: true/);
  assert.doesNotMatch(`${workspace}\n${storage}`, /sozar/i);
});
