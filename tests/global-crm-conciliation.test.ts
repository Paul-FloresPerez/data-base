import assert from "node:assert/strict";
import test from "node:test";

import { materialConflicts } from "../lib/recycling/global-conciliation.ts";

test("distingue campos materiales incompatibles sin convertir ausencias en conflictos", () => {
  assert.deepEqual(materialConflicts([
    { documento: "123-A", nombre: "Ana Pérez", operadorActual: "MásMóvil", fechaPortabilidad: new Date("2026-01-02T00:00:00.000Z"), provenance: "API_REAL" },
    { documento: null, nombre: "ana perez", operadorActual: "MasMovil", fechaPortabilidad: null, provenance: "EXCEL" },
  ]), []);
  assert.deepEqual(materialConflicts([
    { documento: "123", nombre: "Ana Pérez", operadorActual: "Vodafone", fechaPortabilidad: new Date("2026-01-02T00:00:00.000Z"), provenance: "API_REAL" },
    { documento: "999", nombre: "Otra Persona", operadorActual: "Orange", fechaPortabilidad: new Date("2026-02-02T00:00:00.000Z"), provenance: "EXCEL" },
  ]), ["DOCUMENTO", "IDENTIDAD", "OPERADOR_ACTUAL", "FECHA_PORTABILIDAD"]);
});

test("MOCK no aporta operador actual fiable a la conciliación global", () => {
  assert.deepEqual(materialConflicts([
    { documento: null, nombre: null, operadorActual: "Vodafone", fechaPortabilidad: null, provenance: "MOCK" },
    { documento: null, nombre: null, operadorActual: "Orange", fechaPortabilidad: null, provenance: "API_REAL" },
  ]), []);
});
