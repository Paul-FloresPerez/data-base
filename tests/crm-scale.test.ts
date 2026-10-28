import assert from "node:assert/strict";
import test from "node:test";
import * as XLSX from "xlsx";

import { buildCampaignReport } from "../lib/campaigns/campaign-engine.ts";
import { cleanDataset } from "../lib/excel/cleaning.ts";
import { buildEnrichmentOutput } from "../lib/excel/enrichment-output.ts";
import { datasetFromWorkbook } from "../lib/excel/import-excel.ts";
import { buildExportPlan, MAX_BATCH_SIZE } from "../lib/export/xlsx-export.ts";
import { restoreBatch, serializeBatch, splitRecords } from "../lib/persistence/workspace-persistence.ts";
import { indexHlrResultsByNormalizedMobile, linkHlrResultToRecord } from "../lib/services/hlr-result-linkage.ts";
import { createWorkingBatch } from "../lib/workspace/batch.ts";

function crmDataset(recordCount: number) {
  const workbook = XLSX.utils.book_new();
  const headers = ["Teléfono Movil", "Nombres", "Numero Doc", "Dirección", "Operador Actual", "Operador Original", "Portabilidad Desde", "Fecha Portabilidad", "Año", "Mes", "Dia"];
  const rows = Array.from({ length: recordCount }, (_, index) => [
    `6${String(index).padStart(8, "0")}`,
    `Nombre sintético ${index}`,
    String(index).padStart(8, "0"),
    `Dirección sintética ${index}`,
    "", "", "", "", "", "", "",
  ]);
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([headers, ...rows]), "CRM");
  return datasetFromWorkbook(workbook, XLSX, `crm-${recordCount}.xlsx`);
}

test("procesa, conserva y distribuye bases CRM sintéticas de 100, 1.000 y 10.000 filas", () => {
  for (const recordCount of [100, 1_000, 10_000]) {
    const dataset = crmDataset(recordCount);
    const cleaning = cleanDataset(dataset);
    assert.equal(cleaning.validRecords.length, recordCount);
    assert.equal(cleaning.excludedRecords.length, 0);
    assert.equal(dataset.records[0]?.cells[2], "00000000");

    const unorderedResults = cleaning.validRecords.toReversed().map((record) => ({
      mobile: record.normalizedMobile,
      operadorActual: "Orange",
      operadorOriginal: "Movistar",
      operadorDonante: "Movistar",
      fechaPortabilidad: "2026-02-03T00:00:00Z",
      consultedAt: "2026-10-27T00:00:00.000Z",
      source: "TEST" as const,
    }));
    const resultByMobile = indexHlrResultsByNormalizedMobile(unorderedResults);
    const output = buildEnrichmentOutput(dataset, cleaning.validRecords.map((record) => {
      const result = linkHlrResultToRecord(record, resultByMobile);
      assert.ok(result);
      return {
        ...record,
        operador_actual: result.operadorActual ?? "",
        operador_origen: result.operadorOriginal ?? "",
        operador_donante: result.operadorDonante ?? "",
        fecha_portabilidad: result.fechaPortabilidad,
      };
    }), "overwrite");
    assert.equal(output.rows.length, recordCount);
    assert.equal(output.rows[0]?.cells[2], "00000000");
    assert.equal(output.rows.at(-1)?.cells[output.columns.indexOf("Año")], "2026");

    const report = buildCampaignReport(output, ["yoigo", "vodafone"]);
    const plan = buildExportPlan(report, ["yoigo", "vodafone"], MAX_BATCH_SIZE);
    assert.equal(plan.totalEligible, recordCount * 2);
    assert.equal(plan.uniqueEligibleCount, recordCount);
    assert.equal(plan.conflictCount, recordCount);
    assert.ok(plan.campaigns.every((campaign) => campaign.eligibleCount === recordCount));
    assert.ok(plan.campaigns.every((campaign) => campaign.batches.every((batch) => batch.rows.length <= MAX_BATCH_SIZE)));
    assert.ok(plan.campaigns.every((campaign) => campaign.batches.flatMap((batch) => batch.rows).length === recordCount));

    const batch = createWorkingBatch(dataset, "00000000-0000-4000-8000-000000000001", "2026-10-27T00:00:00.000Z");
    batch.cleaning = cleaning;
    batch.enrichmentOutput = output;
    batch.provenanceBySourceRow = Object.fromEntries(cleaning.validRecords.map((record) => [record.sourceRow, "MOCK"]));
    const saved = serializeBatch(batch, `CRM ${recordCount}`);
    const chunks = splitRecords(saved.records);
    assert.equal(saved.records.length, recordCount);
    assert.equal(chunks.length, Math.ceil(recordCount / 100));
    assert.ok(chunks.every((chunk) => chunk.length <= 100));
    const restored = restoreBatch({ id: saved.start.id, name: saved.start.name, createdAt: batch.createdAt, metadata: { ...saved.start.metadata, completed: true, revision: null }, records: saved.records.map((record, index) => ({ ...record, id: String(index) })) });
    assert.equal(restored.dataset.records.length, recordCount);
    assert.equal(restored.enrichmentOutput?.rows.length, recordCount);
    assert.equal(restored.provenanceBySourceRow[2], "MOCK");
  }
});
