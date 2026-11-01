import assert from "node:assert/strict";
import test from "node:test";

import { conciliateCrmRows } from "../lib/recycling/conciliation.ts";

const original = new Set(["612345678", "712345678"]);

test("concilia archivos de nombres distintos contra una sola base por móvil normalizado", () => {
  const result = conciliateCrmRows([
    { fileId: "enero", fileName: "CRM_ENE.xlsx", sourceRow: 2, mobile: "+34 612 345 678" },
    { fileId: "febrero", fileName: "GESTIONES_FEB.xlsx", sourceRow: 2, mobile: "0034-712-345-678" },
  ], original);
  assert.equal(result.totalRows, 2);
  assert.equal(result.uniqueFoundMobiles, 2);
  assert.equal(result.files.length, 2);
});

test("distingue filas inválidas, no encontradas, repetidas y gestiones históricas", () => {
  const result = conciliateCrmRows([
    { fileId: "a", fileName: "enero.xlsx", sourceRow: 2, mobile: "612345678" },
    { fileId: "a", fileName: "enero.xlsx", sourceRow: 3, mobile: "612345678" },
    { fileId: "a", fileName: "enero.xlsx", sourceRow: 4, mobile: "912345678" },
    { fileId: "a", fileName: "enero.xlsx", sourceRow: 5, mobile: "622222222" },
  ], original);
  assert.equal(result.totalRows, 4);
  assert.equal(result.invalidRows, 1);
  assert.equal(result.uniqueValidMobiles, 2);
  assert.equal(result.uniqueFoundMobiles, 1);
  assert.equal(result.uniqueMissingMobiles, 1);
  assert.equal(result.duplicateRows, 1);
  assert.equal(result.mobilesWithMultipleManagements, 1);
  assert.deepEqual(result.files[0]?.incidents.map((item) => item.reason).sort(), ["MOVIL_INVALIDO", "MOVIL_NO_ENCONTRADO", "MOVIL_REPETIDO"]);
});

test("soporta una conciliación de diez mil filas sin confundir filas y móviles únicos", () => {
  const rows = Array.from({ length: 10_000 }, (_, index) => ({ fileId: "lote", fileName: "lote.xlsx", sourceRow: index + 2, mobile: `6${String(index).padStart(8, "0")}` }));
  const result = conciliateCrmRows(rows, new Set(rows.map((row) => row.mobile)));
  assert.equal(result.totalRows, 10_000);
  assert.equal(result.uniqueValidMobiles, 10_000);
  assert.equal(result.uniqueFoundMobiles, 10_000);
  assert.equal(result.duplicateRows, 0);
});
