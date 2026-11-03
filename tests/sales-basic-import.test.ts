import assert from "node:assert/strict";
import test from "node:test";
import { detectSalesMobileColumn, previewSalesImport, suggestSalesColumnMapping } from "../lib/sales/sales-import.ts";

test("el flujo básico detecta una sola columna móvil y confirma cada válido", () => {
  const headers = ["Teléfono Móvil", "Estado", "Asesor"];
  const mapping = suggestSalesColumnMapping(headers);
  assert.equal(mapping.mobile, 0);
  const preview = previewSalesImport([
    { sourceRow: 2, cells: ["+34 612 345 678", "Pendiente", "A"] },
    { sourceRow: 3, cells: ["0034-712345678", "No", "B"] },
  ], { mobile: 0, status: 1, advisor: 2 }, "BASICA");
  assert.equal(preview.summary.validUnique, 2);
  assert.equal(preview.summary.confirmed, 2);
  assert.deepEqual(preview.events.map((event) => event.saleStatus), ["CONFIRMADA", "CONFIRMADA"]);
  assert.deepEqual(preview.events.map((event) => event.soldAt), [null, null]);
});

test("no selecciona una columna móvil ambigua y conserva incidencias", () => {
  const headers = ["Móvil", "Número Emitido", "Notas"];
  const detection = detectSalesMobileColumn(headers);
  assert.equal(detection.selected, undefined);
  assert.equal(detection.ambiguous, true);
  const preview = previewSalesImport([
    { sourceRow: 2, cells: ["912345678"] },
    { sourceRow: 3, cells: ["612345678"] },
    { sourceRow: 4, cells: ["612345678"] },
  ], { mobile: 0 }, "BASICA");
  assert.deepEqual(preview.summary, { totalRows: 3, validUnique: 1, invalid: 1, duplicates: 1, confirmed: 1, ambiguous: 0 });
});

test("el modo avanzado conserva el estado comercial opcional", () => {
  const preview = previewSalesImport([{ sourceRow: 2, cells: ["612345678", "Por confirmar"] }], { mobile: 0, status: 1 }, "AVANZADA");
  assert.equal(preview.events[0]?.saleStatus, "AMBIGUA");
  assert.equal(preview.summary.confirmed, 0);
});

test("un archivo sin móviles válidos no genera ventas confirmadas", () => {
  const preview = previewSalesImport([{ sourceRow: 2, cells: ["DNI-123"] }, { sourceRow: 3, cells: ["912345678"] }], { mobile: 0 }, "BASICA");
  assert.equal(preview.summary.validUnique, 0);
  assert.equal(preview.summary.confirmed, 0);
  assert.equal(preview.summary.invalid, 2);
});
