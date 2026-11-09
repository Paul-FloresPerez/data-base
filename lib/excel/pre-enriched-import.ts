import { normalizeOperator, parsePortabilityDate } from "../campaigns/campaign-engine.ts";
import type { CleaningResult, EnrichmentOutput, ImportedDataset } from "./types.ts";

export interface PreEnrichedImportSummary {
  invalidPortabilityDates: number;
  missingCurrentOperator: number;
  portabilityDatesPresent: number;
  recognizedCurrentOperator: number;
  unknownCurrentOperator: number;
}

/**
 * Keeps a pre-enriched workbook as supplied. This is deliberately not an HLR
 * adapter: missing or unknown commercial values remain missing or unknown and
 * are later resolved by the normal campaign rules.
 */
export function outputFromPreEnrichedExcel(dataset: ImportedDataset, cleaning: CleaningResult): EnrichmentOutput {
  return {
    columns: [...dataset.columns],
    rows: cleaning.validRecords.map((record) => ({ sourceRow: record.sourceRow, cells: [...record.cells] })),
  };
}

export function summarizePreEnrichedExcel(dataset: ImportedDataset, cleaning: CleaningResult): PreEnrichedImportSummary {
  const operatorIndex = dataset.columnMapping.enriched.operador_actual;
  const portabilityIndex = dataset.columnMapping.enriched.fecha_portabilidad;
  const summary: PreEnrichedImportSummary = {
    invalidPortabilityDates: 0,
    missingCurrentOperator: 0,
    portabilityDatesPresent: 0,
    recognizedCurrentOperator: 0,
    unknownCurrentOperator: 0,
  };

  for (const record of cleaning.validRecords) {
    const operator = operatorIndex === undefined ? "" : (record.cells[operatorIndex] ?? "").trim();
    if (!operator) summary.missingCurrentOperator += 1;
    else if (normalizeOperator(operator)) summary.recognizedCurrentOperator += 1;
    else summary.unknownCurrentOperator += 1;

    const portability = portabilityIndex === undefined ? "" : (record.cells[portabilityIndex] ?? "").trim();
    if (portability) {
      summary.portabilityDatesPresent += 1;
      if (!parsePortabilityDate(portability)) summary.invalidPortabilityDates += 1;
    }
  }

  return summary;
}
