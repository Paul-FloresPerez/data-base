import type { WorkBook } from "xlsx";

import { normalizeSpanishMobile } from "./cleaning.ts";
import { buildEnrichmentOutput } from "./enrichment-output.ts";
import { MAX_LOCAL_XLSX_BYTES, normalizeColumnName } from "./import-excel.ts";
import type { CleaningResult, EnrichedRecord, EnrichmentOutput, ImportedDataset, ValidRecord } from "./types.ts";
import type { RecordProvenance } from "../workspace/batch.ts";
import type { HlrConsultationMetadata } from "../services/hlr-contract.ts";

const HISTORICAL_MOBILE_HEADER = "numeroemitido";
const historicalFieldHeaders = {
  operadorActual: "operadoractual",
  operadorOriginal: "operadororiginal",
  operadorDonante: "portabilidaddesde",
  fechaPortabilidad: "fechaportabilidad",
} as const;

export interface HistoricalResultImportSummary {
  sourceFileName: string;
  sourceColumns: string[];
  matched: number;
  applied: number;
  missingForBase: number;
  resultsWithoutBase: number;
  invalidResults: number;
  duplicateResults: number;
  skippedApiReal: number;
}

export interface HistoricalResultsMerge {
  output: EnrichmentOutput;
  appliedSourceRows: number[];
  summary: HistoricalResultImportSummary;
}

export class HistoricalResultsImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HistoricalResultsImportError";
  }
}

interface HistoricalResultRow {
  cells: string[];
  fields: { operadorActual: string; operadorOriginal: string; operadorDonante: string; fechaPortabilidad: string };
}

function asText(value: unknown): string {
  return value === null || value === undefined ? "" : String(value);
}

function rowsFromWorkbook(workbook: WorkBook, xlsx: typeof import("xlsx")) {
  const sheetName = workbook.SheetNames[0];
  if (!sheetName || !workbook.Sheets[sheetName]) throw new HistoricalResultsImportError("El Excel histórico no contiene una hoja legible.");
  const rows = xlsx.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], { header: 1, defval: "", raw: false, blankrows: true });
  const headers = (rows[0] ?? []).map(asText);
  if (headers.length === 0 || headers.every((header) => !header.trim())) throw new HistoricalResultsImportError("El Excel histórico no contiene encabezados.");
  return { headers, rows: rows.slice(1).filter((row) => row.some((value) => asText(value).trim())) };
}

function findHeaderIndexes(headers: string[]) {
  const indexes = new Map<string, number>();
  for (const [index, header] of headers.entries()) {
    const normalized = normalizeColumnName(header);
    if (!indexes.has(normalized)) indexes.set(normalized, index);
  }
  const mobileIndex = indexes.get(HISTORICAL_MOBILE_HEADER);
  if (mobileIndex === undefined) throw new HistoricalResultsImportError("El Excel histórico necesita la columna “Número Emitido”.");
  return { mobileIndex, indexes };
}

function historicalValue(row: string[], indexes: Map<string, number>, header: string): string {
  const index = indexes.get(header);
  return index === undefined ? "" : row[index] ?? "";
}

interface ExistingOutputLookup {
  columns: Map<string, number>;
  rows: Map<number, string[]>;
}

function buildExistingOutputLookup(output: EnrichmentOutput | null | undefined): ExistingOutputLookup {
  return {
    columns: new Map((output?.columns ?? []).map((header, index) => [normalizeColumnName(header), index])),
    rows: new Map((output?.rows ?? []).map((row) => [row.sourceRow, row.cells])),
  };
}

function previousFieldValue(
  output: ExistingOutputLookup,
  sourceRow: number,
  header: string,
): string {
  const row = output.rows.get(sourceRow);
  const index = output.columns.get(normalizeColumnName(header));
  return row && index !== undefined ? row[index] ?? "" : "";
}

function mergeHistoricalColumns(
  output: EnrichmentOutput,
  previousOutput: EnrichmentOutput | null | undefined,
  historicalHeaders: string[],
  appliedBySourceRow: Map<number, HistoricalResultRow>,
): EnrichmentOutput {
  const previousIndexes = new Map((previousOutput?.columns ?? []).map((header, index) => [header, index]));
  const previousRows = new Map((previousOutput?.rows ?? []).map((row) => [row.sourceRow, row.cells]));
  const historicalIndexes = new Map(historicalHeaders.map((header, index) => [header, index]));
  const additionalColumns = [
    ...(previousOutput?.columns ?? []).filter((header) => !output.columns.includes(header)),
    ...historicalHeaders.filter((header) => !output.columns.includes(header) && !(previousOutput?.columns ?? []).includes(header)),
  ];
  return {
    columns: [...output.columns, ...additionalColumns],
    rows: output.rows.map((row) => {
      const historical = appliedBySourceRow.get(row.sourceRow);
      const additionalCells = additionalColumns.map((header) => {
        const historicalIndex = historicalIndexes.get(header);
        const historicalValue = historical && historicalIndex !== undefined ? historical.cells[historicalIndex] ?? "" : "";
        if (historicalValue) return historicalValue;
        const previousIndex = previousIndexes.get(header);
        const previous = previousRows.get(row.sourceRow);
        return previous && previousIndex !== undefined ? previous[previousIndex] ?? "" : "";
      });
      return { sourceRow: row.sourceRow, cells: [...row.cells, ...additionalCells] };
    }),
  };
}

/**
 * Imports a historical Excel export locally. It is a keyed reconciliation,
 * never a provider response: only normalized mobiles may match, API_REAL rows
 * are preserved, and duplicate historical rows are reported instead of chosen.
 */
export function mergeHistoricalResults(input: {
  dataset: ImportedDataset;
  cleaning: CleaningResult;
  workbook: WorkBook;
  xlsx: typeof import("xlsx");
  sourceFileName: string;
  provenanceBySourceRow: Record<number, RecordProvenance>;
  realHlrConsultationsByMobile: Record<string, HlrConsultationMetadata>;
  existingOutput?: EnrichmentOutput | null;
}): HistoricalResultsMerge {
  const { headers, rows } = rowsFromWorkbook(input.workbook, input.xlsx);
  const { mobileIndex, indexes } = findHeaderIndexes(headers);
  const parsed = new Map<string, HistoricalResultRow>();
  const duplicateMobiles = new Set<string>();
  let invalidResults = 0;

  for (const sourceRow of rows) {
    const cells = headers.map((_, index) => asText(sourceRow[index]));
    const mobile = normalizeSpanishMobile(cells[mobileIndex] ?? "");
    if (!mobile) {
      invalidResults += 1;
      continue;
    }
    if (parsed.has(mobile) || duplicateMobiles.has(mobile)) {
      parsed.delete(mobile);
      duplicateMobiles.add(mobile);
      continue;
    }
    parsed.set(mobile, {
      cells,
      fields: {
        operadorActual: historicalValue(cells, indexes, historicalFieldHeaders.operadorActual),
        operadorOriginal: historicalValue(cells, indexes, historicalFieldHeaders.operadorOriginal),
        operadorDonante: historicalValue(cells, indexes, historicalFieldHeaders.operadorDonante),
        fechaPortabilidad: historicalValue(cells, indexes, historicalFieldHeaders.fechaPortabilidad),
      },
    });
  }

  const historicalBySourceRow = new Map<number, HistoricalResultRow>();
  const appliedSourceRows: number[] = [];
  const validByMobile = new Map(input.cleaning.validRecords.map((record) => [record.normalizedMobile, record]));
  let skippedApiReal = 0;
  let matched = 0;
  for (const [mobile, historical] of parsed) {
    const record = validByMobile.get(mobile);
    if (!record) continue;
    matched += 1;
    const apiReal = input.provenanceBySourceRow[record.sourceRow] === "API_REAL" || Boolean(input.realHlrConsultationsByMobile[mobile]);
    if (apiReal) {
      skippedApiReal += 1;
      continue;
    }
    historicalBySourceRow.set(record.sourceRow, historical);
    appliedSourceRows.push(record.sourceRow);
  }

  const existingLookup = buildExistingOutputLookup(input.existingOutput);
  const enriched: EnrichedRecord[] = input.cleaning.validRecords.map((record: ValidRecord) => {
    const historical = historicalBySourceRow.get(record.sourceRow);
    const existingActual = previousFieldValue(existingLookup, record.sourceRow, "Operador Actual") || (input.dataset.columnMapping.enriched.operador_actual === undefined ? "" : record.cells[input.dataset.columnMapping.enriched.operador_actual] ?? "");
    const existingOriginal = previousFieldValue(existingLookup, record.sourceRow, "Operador Original") || (input.dataset.columnMapping.enriched.operador_origen === undefined ? "" : record.cells[input.dataset.columnMapping.enriched.operador_origen] ?? "");
    const existingDonor = previousFieldValue(existingLookup, record.sourceRow, "Portabilidad Desde") || (input.dataset.columnMapping.enriched.portabilidad_desde === undefined ? "" : record.cells[input.dataset.columnMapping.enriched.portabilidad_desde] ?? "");
    const existingDate = previousFieldValue(existingLookup, record.sourceRow, "Fecha Portabilidad") || (input.dataset.columnMapping.enriched.fecha_portabilidad === undefined ? "" : record.cells[input.dataset.columnMapping.enriched.fecha_portabilidad] ?? "");
    return {
      ...record,
      operador_actual: historical?.fields.operadorActual || existingActual,
      operador_origen: historical?.fields.operadorOriginal || existingOriginal,
      operador_donante: historical?.fields.operadorDonante || existingDonor,
      fecha_portabilidad: historical?.fields.fechaPortabilidad || existingDate || null,
    };
  });

  const baseOutput = buildEnrichmentOutput(input.dataset, enriched, "overwrite");
  const output = mergeHistoricalColumns(baseOutput, input.existingOutput, headers, historicalBySourceRow);
  const resultsWithoutBase = [...parsed.keys()].filter((mobile) => !validByMobile.has(mobile)).length;
  const missingForBase = input.cleaning.validRecords.filter((record) => !parsed.has(record.normalizedMobile)).length;
  return {
    output,
    appliedSourceRows,
    summary: {
      sourceFileName: input.sourceFileName,
      sourceColumns: headers,
      matched,
      applied: appliedSourceRows.length,
      missingForBase,
      resultsWithoutBase,
      invalidResults,
      duplicateResults: duplicateMobiles.size,
      skippedApiReal,
    },
  };
}

export async function importHistoricalResultsFile(input: Omit<Parameters<typeof mergeHistoricalResults>[0], "workbook" | "xlsx" | "sourceFileName"> & { file: File }): Promise<HistoricalResultsMerge> {
  if (!input.file.name.toLocaleLowerCase("es-ES").endsWith(".xlsx")) throw new HistoricalResultsImportError("Selecciona un Excel histórico con extensión .xlsx.");
  if (input.file.size > MAX_LOCAL_XLSX_BYTES) throw new HistoricalResultsImportError("El Excel histórico supera el límite local de 25 MB.");
  try {
    const [xlsx, buffer] = await Promise.all([import("xlsx"), input.file.arrayBuffer()]);
    const workbook = xlsx.read(buffer, { type: "array" });
    return mergeHistoricalResults({ ...input, workbook, xlsx, sourceFileName: input.file.name });
  } catch (error) {
    if (error instanceof HistoricalResultsImportError) throw error;
    throw new HistoricalResultsImportError("No se pudo leer el Excel histórico.");
  }
}
