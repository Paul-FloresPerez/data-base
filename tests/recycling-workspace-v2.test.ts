import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("el espacio de reciclaje separa conciliación, evaluación y generación sin habilitar candidatos artificiales", async () => {
  const component = await readFile(new URL("../components/recycling-workspace-v2.tsx", import.meta.url), "utf8");
  assert.match(component, /1\. Conciliar archivo CRM/);
  assert.match(component, /2\. Evaluar reciclaje/);
  assert.match(component, /3\. Generar base reciclada/);
  assert.match(component, /evaluatedEligible === 0/);
  assert.match(component, /No se encontraron móviles coincidentes con la base original seleccionada/);
  assert.match(component, /Tipificaciones que deseo evaluar para reciclar/);
  assert.match(component, /No se evaluaron coincidencias de la base original/);
  assert.match(component, /gestiones CRM locales seleccionadas; aún no son elegibles/);
  assert.match(component, /Incidencias locales del archivo CRM/);
  assert.match(component, /conciliation\?\.uniqueFoundMobiles \?\? 0\) === 0/);
  assert.doesNotMatch(component, /conciliationRows\.length \? 1 : 0/);
  assert.match(component, /importIdFromFingerprint/);
});

test("la interfaz diferencia coincidencias CRM locales de elegibilidad persistida", async () => {
  const component = await readFile(new URL("../components/recycling-workspace-v2.tsx", import.meta.url), "utf8");
  assert.match(component, /uniqueFoundMobiles === 0/);
  assert.match(component, /gestiones CRM locales seleccionadas; aún no son elegibles/);
  assert.match(component, /no equivale a elegible hasta conciliar y evaluar en servidor/);
});

test("la conciliación muestra progreso, llama a las rutas protegidas y permite reintentar sin duplicar la operación", async () => {
  const component = await readFile(new URL("../components/recycling-workspace-v2.tsx", import.meta.url), "utf8");
  const route = await readFile(new URL("../app/api/reciclaje/[executionId]/conciliar/route.ts", import.meta.url), "utf8");

  assert.match(component, /setIsConciliating\(true\)/);
  assert.match(component, /Conciliando archivos CRM con la base original seleccionada/);
  assert.match(component, /"\/api\/reciclaje"/);
  assert.match(component, /\/api\/reciclaje\/\$\{started\.id\}\/conciliar/);
  assert.match(component, /preparation\.current/);
  assert.match(component, /El Excel no contiene filas CRM para conciliar/);
  assert.match(component, /setExecution\(null\)/);
  assert.match(route, /error instanceof Error \? error\.message/);
});
