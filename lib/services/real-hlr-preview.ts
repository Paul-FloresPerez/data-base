import type { CleaningResult, EnrichmentOutput, ImportedDataset } from "../excel/types.ts";
import type { RecordProvenance } from "../workspace/batch.ts";

export interface RealHlrPreview {
  validRecords: number;
  uniqueMobiles: number;
  fixedExcluded: number;
  invalidExcluded: number;
  duplicateExcluded: number;
  enrichedByRealApi: number;
  enrichedFromExistingData: number;
  pendingQueries: number;
}

interface ExistingOutputLookup {
  rows: Map<number, string[]>;
  actualIndex: number;
  originalIndex: number;
}

function outputLookup(output?: EnrichmentOutput | null): ExistingOutputLookup {
  return {
    rows: new Map((output?.rows ?? []).map((row) => [row.sourceRow, row.cells])),
    actualIndex: output?.columns.indexOf("Operador Actual") ?? -1,
    originalIndex: output?.columns.indexOf("Operador Original") ?? -1,
  };
}

function hasExistingOperators(record: CleaningResult["validRecords"][number], dataset: ImportedDataset, output: ExistingOutputLookup) {
  const outputRow = output.rows.get(record.sourceRow);
  const outputActual = output.actualIndex;
  const outputOriginal = output.originalIndex;
  if (outputRow && outputActual >= 0 && outputOriginal >= 0) {
    return Boolean(outputRow[outputActual]?.trim() && outputRow[outputOriginal]?.trim());
  }
  const actual = dataset.columnMapping.enriched.operador_actual;
  const original = dataset.columnMapping.enriched.operador_origen;
  return Boolean(record.cells[actual ?? -1]?.trim() && record.cells[original ?? -1]?.trim());
}

/** Groups by mobile so a future execution cannot charge the same contact twice. */
export function getRealHlrPreview(
  cleaning: CleaningResult,
  dataset: ImportedDataset,
  provenanceBySourceRow: Record<number, RecordProvenance>,
  output?: EnrichmentOutput | null,
): RealHlrPreview {
  const existingOutput = outputLookup(output);
  const byMobile = new Map<string, { real: boolean; existing: boolean }>();
  for (const record of cleaning.validRecords) {
    const current = byMobile.get(record.normalizedMobile) ?? { real: false, existing: false };
    current.real ||= provenanceBySourceRow[record.sourceRow] === "API_REAL";
    current.existing ||= hasExistingOperators(record, dataset, existingOutput);
    byMobile.set(record.normalizedMobile, current);
  }
  let enrichedByRealApi = 0;
  let enrichedFromExistingData = 0;
  let pendingQueries = 0;
  for (const status of byMobile.values()) {
    if (status.real) enrichedByRealApi += 1;
    else if (status.existing) enrichedFromExistingData += 1;
    else pendingQueries += 1;
  }
  return {
    validRecords: cleaning.validRecords.length,
    uniqueMobiles: byMobile.size,
    fixedExcluded: cleaning.reasonBreakdown.telefono_fijo,
    invalidExcluded: cleaning.reasonBreakdown.telefono_vacio + cleaning.reasonBreakdown.telefono_invalido,
    duplicateExcluded: cleaning.reasonBreakdown.telefono_duplicado,
    enrichedByRealApi,
    enrichedFromExistingData,
    pendingQueries,
  };
}

export function getPendingRealHlrRecords(
  cleaning: CleaningResult,
  dataset: ImportedDataset,
  provenanceBySourceRow: Record<number, RecordProvenance>,
  output?: EnrichmentOutput | null,
) {
  const existingOutput = outputLookup(output);
  return cleaning.validRecords.filter((record) =>
    provenanceBySourceRow[record.sourceRow] !== "API_REAL" && !hasExistingOperators(record, dataset, existingOutput),
  );
}
