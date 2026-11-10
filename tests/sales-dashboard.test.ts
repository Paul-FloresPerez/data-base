import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("el resumen de ventas atribuye solo mediante relaciones de lote persistidas", async () => {
  const [storage, route, workspace] = await Promise.all([
    readFile(new URL("../lib/server/sales-storage.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/ventas/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../components/sales-workspace.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(storage, /export async function externalSalesDashboard/);
  assert.match(storage, /prisma\.loteRegistro\.findMany/);
  assert.match(storage, /withoutDistributionEvidence/);
  assert.match(storage, /ambiguousDistribution/);
  assert.match(storage, /declaredAdvisor/);
  assert.match(storage, /deliberately not an inferred lot owner/);
  assert.match(route, /externalSalesDashboard/);
  assert.match(workspace, /Resumen de ventas confirmadas/);
  assert.match(workspace, /un asesor declarado por archivo no se infiere como responsable del lote/);
});
