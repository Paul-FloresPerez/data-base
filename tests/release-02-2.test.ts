import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("el autosave persiste una base sin convertir la vista previa en distribución comercial", async () => {
  const client = await readFile(new URL("../lib/persistence/client-base-save.ts", import.meta.url), "utf8");
  const storage = await readFile(new URL("../lib/server/base-storage.ts", import.meta.url), "utf8");

  assert.match(client, /options\.confirmCommercialDistribution \? buildStoredLots\(batch\) : \[\]/);
  assert.match(storage, /editableOperationalSave = existing\._count\.lotes === 0/);
  assert.match(storage, /commercialDistributionConfirmed: lots\.length > 0/);
});

test("las descargas de vista previa se generan localmente y la comercial exige confirmación", async () => {
  const component = await readFile(new URL("../components/export-workspace.tsx", import.meta.url), "utf8");

  assert.match(component, /createCampaignZip/);
  assert.match(component, /createSingleCampaignZip/);
  assert.match(component, /VISTA_PREVIA_CAMPANAS\.zip/);
  assert.match(component, /Vista previa local/);
  assert.match(component, /Descarga comercial confirmada/);
  assert.match(component, /disabled=\{!batch\.commercialDistributionConfirmed/);
});

test("la confirmación comercial es explícita y bloquea modificaciones posteriores", async () => {
  const workspace = await readFile(new URL("../components/excel-workspace.tsx", import.meta.url), "utf8");
  const distribution = await readFile(new URL("../components/distribution-workspace.tsx", import.meta.url), "utf8");

  assert.match(workspace, /confirmCommercialDistribution/);
  assert.match(workspace, /confirmCommercialDistribution: true/);
  assert.match(workspace, /currentBatch\?\.commercialDistributionConfirmed/);
  assert.match(distribution, /Confirmar distribución comercial/);
  assert.match(distribution, /disabled=\{commercialDistributionConfirmed\}/);
});
