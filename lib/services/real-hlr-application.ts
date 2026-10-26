import { normalizeSpanishMobile } from "../excel/cleaning.ts";
import { buildEnrichmentOutput } from "../excel/enrichment-output.ts";
import type { EnrichedRecord, EnrichmentOutput, ImportedDataset, ValidRecord } from "../excel/types.ts";
import type { HlrEnrichmentResult } from "./hlr-contract.ts";

export class RealHlrApplicationError extends Error {}

/**
 * Applies a real result only to the record identified by its normalized mobile.
 * It intentionally has no row-index lookup and emits a fresh immutable output,
 * preserving every source cell and the original record order.
 */
export function applyRealHlrResultToEnrichmentOutput(input: {
  dataset: ImportedDataset;
  validRecords: readonly ValidRecord[];
  result: HlrEnrichmentResult;
}): { output: EnrichmentOutput; updatedSourceRows: number[] } {
  if (input.result.source !== "API_REAL") {
    throw new RealHlrApplicationError("Solo un resultado real verificado puede aplicarse a la base.");
  }
  const normalizedMobile = normalizeSpanishMobile(input.result.mobile);
  if (!normalizedMobile) throw new RealHlrApplicationError("El resultado real no contiene un móvil español válido.");

  const actualIndex = input.dataset.columnMapping.enriched.operador_actual;
  const originalIndex = input.dataset.columnMapping.enriched.operador_origen;
  const donorIndex = input.dataset.columnMapping.enriched.portabilidad_desde;
  const dateIndex = input.dataset.columnMapping.enriched.fecha_portabilidad;
  const updatedSourceRows: number[] = [];

  const enrichedRecords: EnrichedRecord[] = input.validRecords.map((record) => {
    const existing: EnrichedRecord = {
      ...record,
      operador_actual: actualIndex === undefined ? "" : record.cells[actualIndex] ?? "",
      operador_origen: originalIndex === undefined ? "" : record.cells[originalIndex] ?? "",
      operador_donante: donorIndex === undefined ? "" : record.cells[donorIndex] ?? "",
      fecha_portabilidad: dateIndex === undefined ? null : record.cells[dateIndex] || null,
    };
    if (record.normalizedMobile !== normalizedMobile) return existing;

    updatedSourceRows.push(record.sourceRow);
    return {
      ...existing,
      operador_actual: input.result.operadorActual ?? existing.operador_actual,
      operador_origen: input.result.operadorOriginal ?? existing.operador_origen,
      operador_donante: input.result.operadorDonante ?? existing.operador_donante,
      fecha_portabilidad: input.result.fechaPortabilidad ?? existing.fecha_portabilidad,
    };
  });

  if (updatedSourceRows.length !== 1) {
    throw new RealHlrApplicationError("El resultado real no coincide de forma única con un registro válido de la base.");
  }

  return { output: buildEnrichmentOutput(input.dataset, enrichedRecords, "overwrite"), updatedSourceRows };
}
