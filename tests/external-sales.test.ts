import assert from "node:assert/strict";
import test from "node:test";
import { evaluateIntelligentRecycling } from "../lib/recycling/intelligent-recycling.ts";
import { previewSalesImport, suggestSalesColumnMapping } from "../lib/sales/sales-import.ts";

test("reconoce encabezados comerciales variables y normaliza móviles españoles", () => {
  const mapping = suggestSalesColumnMapping(["Nº Emitido", "Fecha Venta", "Estado", "Agente", "Campaña"]);
  assert.deepEqual(mapping, { mobile: 0, soldAt: 1, status: 2, advisor: 3, campaign: 4 });
  const result = previewSalesImport([
    { sourceRow: 2, cells: ["+34 612-345-678", "2026-11-01", "Confirmada", "A", "Yoigo"] },
    { sourceRow: 3, cells: ["0034612345678", "2026-11-01", "Pendiente", "A", "Yoigo"] },
    { sourceRow: 4, cells: ["912345678", "2026-11-01", "Confirmada", "A", "Yoigo"] },
  ], mapping as { mobile: number; soldAt: number; status: number; advisor: number; campaign: number });
  assert.deepEqual(result.summary, { totalRows: 3, validUnique: 1, invalid: 1, duplicates: 1, confirmed: 1, ambiguous: 0 });
  assert.equal(result.events[0]?.mobile, "612345678");
  assert.equal(result.events[1]?.reason, "MOVIL_DUPLICADO");
});

test("una venta externa confirmada bloquea reciclaje aunque una gestión posterior sea NO CONTESTA", () => {
  const result = evaluateIntelligentRecycling(
    [{ id: "r1", mobile: "612345678", portabilityDate: "2025-01-01" }],
    [{ id: "crm-1", mobile: "612345678", managedAt: "2026-11-01", tipificationOriginal: "NO CONTESTA", confirmedSale: false, saleEvidence: null }],
    { effectiveDate: "2026-11-01", minimumDate: "2019-02-01", minimumMonths: 4, recyclableTipifications: ["NO CONTESTA"] },
    new Set(["612345678"]),
  );
  assert.equal(result.decisions[0]?.decision, "BLOQUEADO_VENTA");
  assert.equal(result.decisions[0]?.winningManagementId, null);
});

test("un estado comercial ambiguo no se trata como una venta confirmada", () => {
  const result = previewSalesImport([{ sourceRow: 2, cells: ["712345678", "", "Por confirmar"] }], { mobile: 0, status: 2 });
  assert.equal(result.events[0]?.saleStatus, "AMBIGUA");
  assert.equal(result.summary.confirmed, 0);
  assert.equal(result.summary.ambiguous, 1);
});
