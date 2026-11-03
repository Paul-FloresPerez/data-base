import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("el espacio de reciclaje separa conciliación, evaluación y generación sin habilitar candidatos artificiales", async () => {
  const component = await readFile(new URL("../components/recycling-workspace-v2.tsx", import.meta.url), "utf8");
  assert.match(component, /1\. Conciliar archivo CRM/);
  assert.match(component, /2\. Evaluar reciclaje/);
  assert.match(component, /3\. Generar base reciclada/);
  assert.match(component, /evaluatedEligible === 0/);
  assert.doesNotMatch(component, /conciliationRows\.length \? 1 : 0/);
  assert.match(component, /importIdFromFingerprint/);
});
