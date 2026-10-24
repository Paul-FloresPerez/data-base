import {
  enrichedFieldHeaders,
  enrichedFieldOrder,
  type EnrichedField,
  type EnrichedRecord,
  type EnrichmentMode,
  type EnrichmentOutput,
  type ImportedDataset,
} from "./types.ts";

interface DateParts {
  anio: string;
  mes: string;
  dia: string;
}

const emptyDateParts: DateParts = { anio: "", mes: "", dia: "" };

function isCalendarDate(year: number, month: number, day: number): boolean {
  const candidate = new Date(Date.UTC(year, month - 1, day));
  return (
    candidate.getUTCFullYear() === year &&
    candidate.getUTCMonth() === month - 1 &&
    candidate.getUTCDate() === day
  );
}

export function datePartsFromPortability(value: string | null): DateParts {
  const dateValue = value?.trim();

  if (!dateValue) {
    return emptyDateParts;
  }

  const isoMatch = dateValue.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  const localMatch = dateValue.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  const parts = isoMatch
    ? [Number(isoMatch[1]), Number(isoMatch[2]), Number(isoMatch[3])]
    : localMatch
      ? [Number(localMatch[3]), Number(localMatch[2]), Number(localMatch[1])]
      : null;

  if (!parts || !isCalendarDate(parts[0], parts[1], parts[2])) {
    return emptyDateParts;
  }

  return {
    anio: String(parts[0]),
    mes: String(parts[1]).padStart(2, "0"),
    dia: String(parts[2]).padStart(2, "0"),
  };
}

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
    portabilidad_desde: record.operador_origen,
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
