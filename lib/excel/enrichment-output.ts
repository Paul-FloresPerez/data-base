import {
  enrichedFieldHeaders,
  enrichedFieldOrder,
  type EnrichedField,
  type EnrichedRecord,
  type EnrichmentMode,
  type EnrichmentOutput,
  type ImportedDataset,
} from "./types.ts";
import { datePartsFromPortability } from "./portability-date.ts";
export { datePartsFromPortability } from "./portability-date.ts";

function valuesForRecord(
  dataset: ImportedDataset,
  record: EnrichedRecord,
  mode: EnrichmentMode,
): Record<EnrichedField, string> {
  const existingDateIndex = dataset.columnMapping.enriched.fecha_portabilidad;
  const dateForParts =
    mode === "preserve" && existingDateIndex !== undefined
      ? record.cells[existingDateIndex]
      : record.fecha_portabilidad;
  const dateParts = datePartsFromPortability(dateForParts);

  return {
    operador_actual: record.operador_actual,
    operador_origen: record.operador_origen,
    // "Portabilidad Desde" is the donor operator when one is actually known.
    // Legacy/mock records do not contain it, so their historical value stays
    // compatible with the former output.
    portabilidad_desde: record.operador_donante ?? record.operador_origen,
    fecha_portabilidad: record.fecha_portabilidad ?? "",
    ...dateParts,
  };
}

export function buildEnrichmentOutput(
  dataset: ImportedDataset,
  records: readonly EnrichedRecord[],
  mode: EnrichmentMode,
): EnrichmentOutput {
  const missingFields = enrichedFieldOrder.filter(
    (field) => dataset.columnMapping.enriched[field] === undefined,
  );

  return {
    columns: [...dataset.columns, ...missingFields.map((field) => enrichedFieldHeaders[field])],
    rows: records.map((record) => {
      const values = valuesForRecord(dataset, record, mode);
      const cells = [...record.cells];

      for (const field of enrichedFieldOrder) {
        const existingIndex = dataset.columnMapping.enriched[field];

        if (existingIndex === undefined) {
          cells.push(values[field]);
        } else if (mode === "overwrite" || !cells[existingIndex]?.trim()) {
          cells[existingIndex] = values[field];
        }
      }

      return { sourceRow: record.sourceRow, cells };
    }),
  };
}
