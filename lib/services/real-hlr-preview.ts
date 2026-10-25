import type { CleaningResult, ImportedDataset } from "../excel/types.ts";
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

function hasExistingOperators(record: CleaningResult["validRecords"][number], dataset: ImportedDataset) {
  const actual = dataset.columnMapping.enriched.operador_actual;
  const original = dataset.columnMapping.enriched.operador_origen;
  return Boolean(record.cells[actual ?? -1]?.trim() && record.cells[original ?? -1]?.trim());
}

/** Groups by mobile so a future execution cannot charge the same contact twice. */
export function getRealHlrPreview(
  cleaning: CleaningResult,
  dataset: ImportedDataset,
  provenanceBySourceRow: Record<number, RecordProvenance>,
): RealHlrPreview {
  const byMobile = new Map<string, { real: boolean; existing: boolean }>();
  for (const record of cleaning.validRecords) {
    const current = byMobile.get(record.normalizedMobile) ?? { real: false, existing: false };
    current.real ||= provenanceBySourceRow[record.sourceRow] === "API_REAL";
    current.existing ||= hasExistingOperators(record, dataset);
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
) {
  return cleaning.validRecords.filter((record) =>
    provenanceBySourceRow[record.sourceRow] !== "API_REAL" && !hasExistingOperators(record, dataset),
  );
}
