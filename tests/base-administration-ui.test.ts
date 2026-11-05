import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("..", import.meta.url);

test("la administración de bases usa archivado lógico y no expone eliminación física", async () => {
  const [panel, route, administration] = await Promise.all([
    readFile(new URL("components/saved-bases-panel.tsx", root), "utf8"),
    readFile(new URL("app/api/bases/[baseId]/route.ts", root), "utf8"),
    readFile(new URL("app/api/bases/[baseId]/administracion/route.ts", root), "utf8"),
  ]);
  assert.match(panel, /Confirmar archivado lógico/);
  assert.match(panel, /Restaurar base/);
  assert.match(panel, /Dependencias conservadas/);
  assert.doesNotMatch(panel, /Eliminar\s*<\/button>/);
  assert.match(route, /eliminación física no está disponible/i);
  assert.doesNotMatch(route, /deleteSavedBase/);
  assert.match(administration, /requireAdminApi/);
  assert.match(administration, /payload\.action === "archive"/);
});

test("el detalle global devuelve motivos agregados sin devolver móviles completos", async () => {
  const storage = await readFile(new URL("lib/server/global-recycling-storage.ts", root), "utf8");
  const workspace = await readFile(new URL("components/global-recycling-workspace.tsx", root), "utf8");
  assert.match(storage, /groupBy\(/);
  assert.match(storage, /reasonSummary/);
  assert.match(storage, /mobileMasked/);
  assert.match(workspace, /Motivos agregados de decisión/);
  assert.match(workspace, /reserva activa requiere liberación explícita/i);
});
