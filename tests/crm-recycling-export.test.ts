import assert from "node:assert/strict";
import test from "node:test";
import * as XLSX from "xlsx";
import { buildCampaignReport } from "../lib/campaigns/campaign-engine.ts";
import { datasetFromWorkbook } from "../lib/excel/import-excel.ts";
import { CRM_RECYCLING_HEADERS, assertCrmRecyclingContract, buildCrmRecyclingOutput } from "../lib/export/crm-recycling-export.ts";
import { buildExportPlan, createManifestWorkbook, createXlsxWorkbook, workbookToArray } from "../lib/export/xlsx-export.ts";

const source = {
  columns: ["Nombres", "Telefono Movil", "Código Postal", "Numero Doc", "Operador Actual", "Operador Original", "Portabilidad Desde", "Fecha Portabilidad", "Correo", "Provincia", "Localidad", "Tipificacion"],
  rows: [{ sourceRow: 7, cells: ["Ana", "612345678", "00123", "00001234", "Orange", "Movistar", "Vodafone", "2026-03-05T00:00:00Z", "", "Madrid", "Madrid", "NO RESPONDE"] }],
};

test("proyecta una base reciclada al contrato CRM exacto sin perder identificadores", () => {
  const projected = buildCrmRecyclingOutput(source);
  assertCrmRecyclingContract(projected);
  assert.deepEqual(projected.columns, CRM_RECYCLING_HEADERS);
  assert.equal(projected.rows[0]?.cells.length, 24);
  assert.deepEqual(projected.rows[0]?.cells.slice(0, 13), ["612345678", "", "NO RESPONDE", "Orange", "Movistar", "Vodafone", "2026-03-05T00:00:00Z", "2026", "03", "05", "00001234", "Ana", ""]);
  assert.equal(projected.rows[0]?.cells[20], "00123");
  assert.equal(projected.rows[0]?.cells[23], "");
});

test("deja vacíos los enriquecimientos ausentes y no inventa fecha ni operadores", () => {
  const projected = buildCrmRecyclingOutput({ columns: ["nums", "Nombres"], rows: [{ sourceRow: 2, cells: ["712345678", "Sin datos"] }] });
  assert.equal(projected.rows[0]?.cells[0], "712345678");
  assert.ok(projected.rows[0]?.cells.slice(1).every((value) => value === "" || value === "Sin datos"));
});

test("el XLSX CRM conserva solamente los 24 encabezados en la primera fila", () => {
  const projected = buildCrmRecyclingOutput(source);
  const workbook = createXlsxWorkbook(XLSX, projected.columns, projected.rows, "YOIGO");
  const reopened = XLSX.read(workbookToArray(XLSX, workbook), { type: "array" });
  const rows = XLSX.utils.sheet_to_json<string[]>(reopened.Sheets.YOIGO!, { header: 1, raw: false });
  assert.deepEqual(rows[0], CRM_RECYCLING_HEADERS);
  assert.equal(rows.length, 2);
  assert.equal(rows[1]?.[10], "00001234");
  assert.equal(rows[1]?.[20], "00123");

  const reimported = datasetFromWorkbook(reopened, XLSX, "reimportacion-crm.xlsx");
  assert.equal(reimported.records.length, 1);
  assert.equal(reimported.records[0]?.cells[0], "612345678");
});

test("mantiene lotes de cien para diez mil registros CRM sintéticos", () => {
  const rows = Array.from({ length: 10_000 }, (_, index) => ({ sourceRow: index + 2, cells: [`6${String(index).padStart(8, "0")}`, "Orange"] }));
  const projected = buildCrmRecyclingOutput({ columns: ["Teléfono Movil", "Operador Actual"], rows });
  const report = buildCampaignReport(projected, ["vodafone"]);
  const plan = buildExportPlan(report, ["vodafone"], 100);
  const campaign = plan.campaigns[0];
  assert.equal(projected.rows.length, 10_000);
  assert.equal(campaign?.batches.length, 100);
  assert.ok(campaign?.batches.every((batch) => batch.rows.length === 100));
});

test("el manifiesto separa lotes e indicadores sin datos de contacto", () => {
  const report = buildCampaignReport(buildCrmRecyclingOutput(source), ["vodafone"]);
  const plan = buildExportPlan(report, ["vodafone"], 100);
  const workbook = createManifestWorkbook(XLSX, plan, { baseId: "base-id", baseOriginalCode: "BAS-2026-03-0001", baseName: "Base reciclada", generatedAt: "2026-03-06T10:00:00.000Z", filters: { provincia: "Madrid" } });
  const lotes = XLSX.utils.sheet_to_json<string[]>(workbook.Sheets.Lotes!, { header: 1, raw: false });
  assert.deepEqual(lotes[0], ["Código de base original", "Nombre", "Fecha", "Campaña", "Lote", "Archivo", "Cantidad de registros", "Estado"]);
  assert.equal(lotes[1]?.[0], "BAS-2026-03-0001");
  assert.equal(lotes[1]?.[7], "GENERADO");
  assert.ok(workbook.Sheets.Indicadores);
});
