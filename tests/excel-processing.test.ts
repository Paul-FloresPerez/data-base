import assert from "node:assert/strict";
import test from "node:test";
import JSZip from "jszip";
import * as XLSX from "xlsx";

import { cleanDataset, isNullLikeName, normalizeSpanishMobile } from "../lib/excel/cleaning.ts";
import {
  buildCampaignReport,
  completedMonthsSincePortability,
  getDetectedCurrentOperators,
  normalizeOperator,
  type CampaignInput,
} from "../lib/campaigns/campaign-engine.ts";
import { buildEnrichmentOutput } from "../lib/excel/enrichment-output.ts";
import { datasetFromWorkbook, ExcelImportError } from "../lib/excel/import-excel.ts";
import {
  buildExportPlan,
  createCampaignZip,
  createCompleteWorkbook,
  MAX_BATCH_SIZE,
  normalizeBatchSize,
  workbookToArray,
} from "../lib/export/xlsx-export.ts";
import {
  enrichedFieldOrder,
  type EnrichedRecord,
  type ImportedDataset,
  type ValidRecord,
} from "../lib/excel/types.ts";
import { simulateHlrMnp, simulateHlrMnpForMobile } from "../lib/services/mock-hlr.ts";
import { createWorkingBatch, getBatchStatus } from "../lib/workspace/batch.ts";

const realHeaders = [
  "Teléfono Movil",
  "Teléfono Contacto",
  "Tipificación",
  "Operador Actual",
  "Operador Original",
  "Portabilidad Desde",
  "Fecha Portabilidad",
  "Año",
  "Mes",
  "Dia",
  "Numero Doc",
  "Nombres",
  "Apellido paterno",
  "Apellido materno",
  "Nombre de calle",
  "Numero",
  "Escalera",
  "Portal",
  "Planta",
  "Puerta",
  "Código Postal",
  "Provincia",
  "Localidad",
  "Correo",
];

const realRow = [
  "+34 612 345 678",
  "712345678",
  "Interesado",
  "Operador existente",
  "Origen existente",
  "Portabilidad existente",
  "2020-01-02",
  "2020",
  "01",
  "02",
  "00123456X",
  "Ana",
  "Pérez",
  "López",
  "Calle Mayor",
  "12",
  "",
  "A",
  "3",
  "B",
  "01234",
  "Madrid",
  "Madrid",
  "ana@example.com",
];

const sampleDataset: ImportedDataset = {
  fileName: "contactos.xlsx",
  columns: ["Móvil", "Documento", "Nombre"],
  columnMapping: {
    movil: 0,
    documento: 1,
    nombre: 2,
    enriched: {},
  },
  records: [
    {
      sourceRow: 2,
      cells: ["+34 612 345 678", "", "Ana"],
      mobile: "+34 612 345 678",
      document: "",
      name: "Ana",
      contactPhone: "",
    },
    {
      sourceRow: 3,
      cells: ["0034-712-345-678", "X1", "N/A"],
      mobile: "0034-712-345-678",
      document: "X1",
      name: "N/A",
      contactPhone: "",
    },
    {
      sourceRow: 4,
      cells: ["912 345 678", "X2", "Bea"],
      mobile: "912 345 678",
      document: "X2",
      name: "Bea",
      contactPhone: "",
    },
    {
      sourceRow: 5,
      cells: ["612345678", "X3", "Carla"],
      mobile: "612345678",
      document: "X3",
      name: "Carla",
      contactPhone: "",
    },
    {
      sourceRow: 6,
      cells: ["712345678", "X4", "Dani"],
      mobile: "712345678",
      document: "X4",
      name: "Dani",
      contactPhone: "",
    },
  ],
};

function datasetWithRealHeaders(): ImportedDataset {
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet([realHeaders, realRow]);
  XLSX.utils.book_append_sheet(workbook, worksheet, "Contactos");

  return datasetFromWorkbook(workbook, XLSX, "contactos.xlsx");
}

test("mapea los 24 encabezados reales y conserva su orden y valores textuales", () => {
  const dataset = datasetWithRealHeaders();

  assert.deepEqual(dataset.columns, realHeaders);
  assert.equal(dataset.columnMapping.movil, 0);
  assert.equal(dataset.columnMapping.telefono_contacto, 1);
  assert.equal(dataset.columnMapping.documento, 10);
  assert.equal(dataset.columnMapping.nombre, 11);
  assert.deepEqual(dataset.columnMapping.enriched, {
    operador_actual: 3,
    operador_origen: 4,
    portabilidad_desde: 5,
    fecha_portabilidad: 6,
    anio: 7,
    mes: 8,
    dia: 9,
  });
  assert.deepEqual(
    dataset.records.map((record) => [record.sourceRow, record.mobile, record.contactPhone, record.document, record.name]),
    [[2, "+34 612 345 678", "712345678", "00123456X", "Ana"]],
  );
  assert.equal(dataset.records[0]?.cells[20], "01234");
});

test("solo exige Teléfono Movil y permite importar sin nombre o documento", () => {
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet([["Celular", "Correo"], ["612345678", "ana@example.com"]]);
  XLSX.utils.book_append_sheet(workbook, worksheet, "Contactos");

  const dataset = datasetFromWorkbook(workbook, XLSX, "sin-nombre.xlsx");

  assert.equal(dataset.columnMapping.movil, 0);
  assert.equal(dataset.columnMapping.nombre, undefined);
  assert.equal(dataset.columnMapping.documento, undefined);
  assert.equal(dataset.records[0]?.name, "");
});

test("informa cuando falta la única columna obligatoria", () => {
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet([["Nombres", "Numero Doc"], ["Ana", "X1"]]);
  XLSX.utils.book_append_sheet(workbook, worksheet, "Contactos");

  assert.throws(
    () => datasetFromWorkbook(workbook, XLSX, "incompleto.xlsx"),
    (error: unknown) => error instanceof ExcelImportError && error.message.includes("Teléfono Movil"),
  );
});

test("normaliza móviles españoles con prefijo y separadores", () => {
  assert.equal(normalizeSpanishMobile("+34 612 345 678"), "612345678");
  assert.equal(normalizeSpanishMobile("0034-712-345-678"), "712345678");
  assert.equal(normalizeSpanishMobile("912 345 678"), null);
  assert.equal(normalizeSpanishMobile("61234567"), null);
});

test("detecta nombres vacíos y valores NULL", () => {
  assert.equal(isNullLikeName(""), true);
  assert.equal(isNullLikeName("  NULL "), true);
  assert.equal(isNullLikeName("n/a"), true);
  assert.equal(isNullLikeName("Ana"), false);
});

test("limpia en orden, conserva el documento vacío y excluye duplicados", () => {
  const cleaned = cleanDataset(sampleDataset);

  assert.deepEqual(
    cleaned.validRecords.map((record) => [record.sourceRow, record.normalizedMobile, record.document]),
    [
      [2, "612345678", ""],
      [6, "712345678", "X4"],
    ],
  );
  assert.deepEqual(
    cleaned.excludedRecords.map((record) => [record.sourceRow, record.reason]),
    [
      [3, "nombre_vacio"],
      [4, "telefono_fijo"],
      [5, "telefono_duplicado"],
    ],
  );
});

test("conserva o sobrescribe los campos enriquecidos sin duplicar las 24 columnas", () => {
  const dataset = datasetWithRealHeaders();
  const baseRecord = dataset.records[0];

  assert.ok(baseRecord);

  const validRecord: ValidRecord = { ...baseRecord, normalizedMobile: "612345678" };
  const simulated: EnrichedRecord = {
    ...validRecord,
    operador_actual: "Movistar",
    operador_origen: "Orange",
    fecha_portabilidad: "2024-02-03",
  };

  const preserved = buildEnrichmentOutput(dataset, [simulated], "preserve");
  const overwritten = buildEnrichmentOutput(dataset, [simulated], "overwrite");

  assert.deepEqual(preserved.columns, realHeaders);
  assert.equal(new Set(preserved.columns).size, realHeaders.length);
  assert.equal(preserved.rows[0]?.cells[3], "Operador existente");
  assert.equal(preserved.rows[0]?.cells[20], "01234");
  assert.deepEqual(overwritten.columns, realHeaders);
  assert.deepEqual(overwritten.rows[0]?.cells.slice(3, 10), [
    "Movistar",
    "Orange",
    "Orange",
    "2024-02-03",
    "2024",
    "02",
    "03",
  ]);
});

test("añade los siete campos enriquecidos cuando no existen", () => {
  const record: ValidRecord = { ...sampleDataset.records[0]!, normalizedMobile: "612345678" };
  const simulated: EnrichedRecord = {
    ...record,
    operador_actual: "Movistar",
    operador_origen: "Orange",
    fecha_portabilidad: null,
  };

  const output = buildEnrichmentOutput(sampleDataset, [simulated], "preserve");

  assert.deepEqual(output.columns.slice(-7), [
    "Operador Actual",
    "Operador Original",
    "Portabilidad Desde",
    "Fecha Portabilidad",
    "Año",
    "Mes",
    "Dia",
  ]);
  assert.deepEqual(output.rows[0]?.cells.slice(-7), ["Movistar", "Orange", "Orange", "", "", "", ""]);
  assert.deepEqual(enrichedFieldOrder, [
    "operador_actual",
    "operador_origen",
    "portabilidad_desde",
    "fecha_portabilidad",
    "anio",
    "mes",
    "dia",
  ]);
});

test("el mock recibe solo los válidos, conserva el orden y es determinista", () => {
  const cleaned = cleanDataset(sampleDataset);
  const firstRun = simulateHlrMnp(cleaned.validRecords);
  const secondRun = simulateHlrMnp(cleaned.validRecords);

  assert.deepEqual(firstRun, secondRun);
  assert.deepEqual(
    firstRun.map((record) => record.sourceRow),
    [2, 6],
  );
  assert.ok(firstRun.every((record) => record.operador_actual.length > 0));
  assert.ok(firstRun.every((record) => record.operador_origen.length > 0));
  assert.ok(firstRun.every((record) => record.operador_actual !== record.operador_origen));

  const dates = Array.from({ length: 10 }, (_, suffix) => `61234567${suffix}`).map(
    (mobile) => simulateHlrMnpForMobile(mobile).fecha_portabilidad,
  );
  assert.ok(dates.some((date) => date === null));
  assert.ok(dates.some((date) => typeof date === "string"));
});

test("solo existen campañas Yoigo y Vodafone, y excluyen solo por operador_actual", () => {
  const input: CampaignInput = {
    columns: ["Operador Actual", "Operador Original"],
    rows: [
      { sourceRow: 2, cells: ["Yoigo", "Vodafone"] },
      { sourceRow: 3, cells: ["Vodafone", "Yoigo"] },
      { sourceRow: 4, cells: ["  ORANGE España ", "Vodafone"] },
    ],
  };

  const report = buildCampaignReport(input, ["vodafone", "yoigo"]);
  const vodafone = report.campaigns.find((campaign) => campaign.operator.id === "vodafone");
  const yoigo = report.campaigns.find((campaign) => campaign.operator.id === "yoigo");

  assert.equal(normalizeOperator("Vodafone España"), "vodafone");
  assert.equal(normalizeOperator("R CABLE"), "r_cable");
  assert.equal(normalizeOperator("Orange"), "orange");
  assert.deepEqual(report.campaigns.map((campaign) => campaign.operator.id), ["yoigo", "vodafone"]);
  assert.deepEqual(yoigo?.excludedByOperator.map((record) => record.sourceRow), [2]);
  assert.deepEqual(yoigo?.eligible.map((record) => record.sourceRow), [3, 4]);
  assert.deepEqual(vodafone?.excludedByOperator.map((record) => record.sourceRow), [3]);
  assert.deepEqual(vodafone?.eligible.map((record) => record.sourceRow), [2, 4]);
});

test("permite ambas campañas y evita repetir una fila dentro de cada una", () => {
  const input: CampaignInput = {
    columns: ["Operador Actual"],
    rows: [
      { sourceRow: 2, cells: ["Yoigo"] },
      { sourceRow: 2, cells: ["Vodafone"] },
      { sourceRow: 3, cells: ["Vodafone"] },
      { sourceRow: 4, cells: ["Orange"] },
    ],
  };

  const report = buildCampaignReport(input, ["yoigo", "vodafone"]);
  const yoigo = report.campaigns.find((campaign) => campaign.operator.id === "yoigo");
  const vodafone = report.campaigns.find((campaign) => campaign.operator.id === "vodafone");

  assert.equal(yoigo?.totalCleanRecords, 3);
  assert.deepEqual(yoigo?.eligible.map((record) => record.sourceRow), [3, 4]);
  assert.deepEqual(vodafone?.eligible.map((record) => record.sourceRow), [2, 4]);
  assert.deepEqual(vodafone?.excludedByOperator.map((record) => record.sourceRow), [3]);
});

test("marca como Sin clasificar operadores vacíos o desconocidos", () => {
  const input: CampaignInput = {
    columns: ["Operador Actual"],
    rows: [
      { sourceRow: 2, cells: ["Operador inventado"] },
      { sourceRow: 3, cells: [""] },
      { sourceRow: 4, cells: ["Pepephone"] },
    ],
  };

  const report = buildCampaignReport(input, ["yoigo"]);
  const campaign = report.campaigns[0];

  assert.equal(campaign?.eligible.length, 1);
  assert.deepEqual(campaign?.unclassified.map((record) => record.sourceRow), [2, 3]);
});

test("aplica filtros de Provincia, Localidad y Código Postal sin alterar sus ceros", () => {
  const input: CampaignInput = {
    columns: ["Operador Actual", "Provincia", "Localidad", "Código Postal"],
    rows: [
      { sourceRow: 2, cells: ["Orange", "Madrid", "Madrid", "01234"] },
      { sourceRow: 3, cells: ["Vodafone", "Madrid", "Alcalá de Henares", "28801"] },
      { sourceRow: 4, cells: ["Yoigo", "Toledo", "Toledo", "01234"] },
    ],
  };

  const report = buildCampaignReport(input, ["vodafone"], {
    provincia: "MÁDRID",
    localidad: "madrid",
    codigo_postal: "01234",
  });
  const campaign = report.campaigns[0];

  assert.deepEqual(report.filteredRecords.map((record) => record.sourceRow), [2]);
  assert.equal(campaign?.totalCleanRecords, 1);
  assert.deepEqual(campaign?.eligible.map((record) => record.cells[3]), ["01234"]);
});

test("genera operadores actuales dinámicos y combina sus filtros con ubicación y antigüedad", () => {
  const input: CampaignInput = {
    columns: ["Operador Actual", "Provincia", "Localidad", "Código Postal", "Fecha Portabilidad"],
    rows: [
      { sourceRow: 2, cells: ["Orange", "Madrid", "Madrid", "01234", "2025-10-12"] },
      { sourceRow: 3, cells: ["Orange", "Madrid", "Madrid", "01234", "2025-10-13"] },
      { sourceRow: 4, cells: ["Pepephone", "Madrid", "Madrid", "01234", "2024-01-01"] },
      { sourceRow: 5, cells: ["Orange", "Toledo", "Toledo", "01234", "2024-01-01"] },
    ],
  };
  const options = getDetectedCurrentOperators(input);
  const orange = options.find((operator) => operator.label === "Orange");

  assert.ok(orange);
  assert.deepEqual(options.map((operator) => operator.label), ["Orange", "Pepephone"]);

  const report = buildCampaignReport(input, ["yoigo", "vodafone"], {
    currentOperatorValues: [orange.value],
    provincia: "MÁDRID",
    localidad: "madrid",
    codigo_postal: "01234",
    minimumPortabilityMonths: 12,
    includeWithoutPortabilityDate: false,
    asOfDate: new Date(2026, 9, 12),
  });

  assert.deepEqual(report.filteredRecords.map((record) => record.sourceRow), [2]);
  assert.equal(report.filterSummary.excludedRecords.length, 3);
  assert.equal(report.filterSummary.reasonBreakdown.antiguedad_portabilidad, 1);
  assert.equal(report.filterSummary.reasonBreakdown.operador_actual, 1);
  assert.equal(report.filterSummary.reasonBreakdown.geografia, 1);
  assert.deepEqual(report.campaigns[0]?.eligible.map((record) => record.sourceRow), [2]);
  assert.deepEqual(report.campaigns[1]?.eligible.map((record) => record.sourceRow), [2]);
});

test("permite incluir o excluir de forma explícita registros sin Fecha Portabilidad", () => {
  const input: CampaignInput = {
    columns: ["Operador Actual", "Fecha Portabilidad"],
    rows: [
      { sourceRow: 2, cells: ["Orange", ""] },
      { sourceRow: 3, cells: ["Movistar", "2025-01-01"] },
    ],
  };

  const included = buildCampaignReport(input, ["yoigo"], {
    minimumPortabilityMonths: 12,
    includeWithoutPortabilityDate: true,
    asOfDate: new Date(2026, 9, 12),
  });
  const excluded = buildCampaignReport(input, ["yoigo"], {
    minimumPortabilityMonths: 12,
    includeWithoutPortabilityDate: false,
    asOfDate: new Date(2026, 9, 12),
  });

  assert.deepEqual(included.filteredRecords.map((record) => record.sourceRow), [2, 3]);
  assert.deepEqual(excluded.filteredRecords.map((record) => record.sourceRow), [3]);
  assert.equal(excluded.filterSummary.reasonBreakdown.fecha_portabilidad_ausente, 1);
});

test("calcula meses completos de antigüedad contra la fecha de referencia", () => {
  const asOfDate = new Date(2026, 9, 12);

  assert.equal(completedMonthsSincePortability("2025-10-12", asOfDate), 12);
  assert.equal(completedMonthsSincePortability("2025-10-13", asOfDate), 11);
  assert.equal(completedMonthsSincePortability("12/10/2025", asOfDate), 12);
  assert.equal(completedMonthsSincePortability("fecha no válida", asOfDate), null);
});

function exportOutput(recordCount: number) {
  return {
    columns: ["Teléfono Movil", "Código Postal", "Tipificación", "Operador Actual", "Nota"],
    rows: Array.from({ length: recordCount }, (_, index) => ({
      sourceRow: index + 2,
      cells: [
        `+346${String(index).padStart(8, "0")}`,
        String(index).padStart(5, "0"),
        "Interesado",
        "Orange",
        index === 0 ? "=HYPERLINK(\"https://example.com\",\"Abrir\")" : "Texto seguro",
      ],
    })),
  };
}

test("planifica lotes de 0, 1, 100, 101 y 253 registros sin cambiar su orden", () => {
  for (const count of [0, 1, 100, 101, 253]) {
    const output = exportOutput(count);
    const report = buildCampaignReport(output, ["yoigo", "vodafone"]);
    const plan = buildExportPlan(report, ["yoigo"], MAX_BATCH_SIZE);
    const yoigo = plan.campaigns[0];

    assert.equal(yoigo?.eligibleCount, count);
    assert.equal(yoigo?.batches.length, count === 0 ? 0 : Math.ceil(count / 100));
    assert.deepEqual(yoigo?.batches.flatMap((batch) => batch.rows.map((row) => row.sourceRow)), output.rows.map((row) => row.sourceRow));
  }
});

test("incluye ambas campañas y mantiene los lotes independientes por operador", () => {
  const output = exportOutput(101);
  const report = buildCampaignReport(output, ["yoigo", "vodafone"]);
  const plan = buildExportPlan(report, ["yoigo", "vodafone"], 100);

  assert.deepEqual(plan.campaigns.map((campaign) => campaign.folderName), ["YOIGO", "VODAFONE"]);
  assert.equal(plan.totalEligible, 202);
  assert.deepEqual(plan.campaigns.map((campaign) => campaign.batches.map((batch) => batch.fileName)), [
    ["LOTE_001.xlsx", "LOTE_002.xlsx"],
    ["LOTE_001.xlsx", "LOTE_002.xlsx"],
  ]);
  assert.equal(normalizeBatchSize(0), 1);
  assert.equal(normalizeBatchSize(253), 100);
});

test("los lotes respetan los filtros activos de campañas", () => {
  const output = {
    columns: ["Operador Actual", "Provincia", "Localidad", "Código Postal", "Fecha Portabilidad"],
    rows: [
      { sourceRow: 2, cells: ["Orange", "Madrid", "Madrid", "01234", "2024-01-01"] },
      { sourceRow: 3, cells: ["Orange", "Toledo", "Toledo", "01234", "2024-01-01"] },
      { sourceRow: 4, cells: ["Vodafone", "Madrid", "Madrid", "01234", "2024-01-01"] },
    ],
  };
  const report = buildCampaignReport(output, ["yoigo", "vodafone"], {
    provincia: "Madrid",
    includeWithoutPortabilityDate: false,
  });
  const plan = buildExportPlan(report, ["yoigo", "vodafone"], 100);

  assert.deepEqual(plan.campaigns[0]?.batches[0]?.rows.map((row) => row.sourceRow), [2, 4]);
  assert.deepEqual(plan.campaigns[1]?.batches[0]?.rows.map((row) => row.sourceRow), [2]);
});

test("crea XLSX de texto seguro y conserva encabezados, teléfonos y códigos postales", () => {
  const output = exportOutput(1);
  const workbook = createCompleteWorkbook(XLSX, output);
  const bytes = workbookToArray(XLSX, workbook);
  const reopened = XLSX.read(bytes, { type: "array" });
  const worksheet = reopened.Sheets[reopened.SheetNames[0]!];

  assert.ok(worksheet);
  assert.deepEqual(XLSX.utils.sheet_to_json<string[]>(worksheet, { header: 1, raw: false })[0], output.columns);
  assert.equal(worksheet.A2?.v, "+34600000000");
  assert.equal(worksheet.B2?.v, "00000");
  assert.equal(worksheet.E2?.f, undefined);
  assert.equal(worksheet.E2?.t, "s");
});

test("genera ZIP con carpetas y archivos de lote esperados", async () => {
  const output = exportOutput(101);
  const report = buildCampaignReport(output, ["yoigo", "vodafone"]);
  const plan = buildExportPlan(report, ["yoigo", "vodafone"], 100);
  const zipBlob = await createCampaignZip(XLSX, new JSZip(), output.columns, plan);
  const reopened = await JSZip.loadAsync(await zipBlob.arrayBuffer());

  assert.ok(reopened.file("YOIGO/LOTE_001.xlsx"));
  assert.ok(reopened.file("YOIGO/LOTE_002.xlsx"));
  assert.ok(reopened.file("VODAFONE/LOTE_001.xlsx"));
  assert.ok(reopened.file("VODAFONE/LOTE_002.xlsx"));
});

test("aísla cada base de trabajo y refleja el avance sin persistir datos", () => {
  const firstBatch = createWorkingBatch(sampleDataset, "base-a", "2026-10-12T10:00:00.000Z");
  const secondBatch = createWorkingBatch(sampleDataset, "base-b", "2026-10-12T10:01:00.000Z");
  const cleanedFirstBatch = { ...firstBatch, cleaning: cleanDataset(firstBatch.dataset) };

  assert.equal(firstBatch.id, "base-a");
  assert.equal(secondBatch.id, "base-b");
  assert.notStrictEqual(firstBatch.distribution, secondBatch.distribution);
  assert.equal(getBatchStatus(firstBatch), "lista_para_limpiar");
  assert.equal(getBatchStatus(cleanedFirstBatch), "lista_para_enriquecer");
  assert.equal(secondBatch.cleaning, null);
  assert.deepEqual(secondBatch.campaignFilters, { includeWithoutPortabilityDate: true });
});
