import type { EnrichmentOutput, ImportedDataset, ValidRecord } from "../excel/types.ts";
import { createWorkingBatch, defaultDistributionSettings, type WorkingBatch } from "../workspace/batch.ts";

/**
 * Produces a derived batch by selecting source rows from one saved original
 * base. It never appends CRM columns to the original Excel dataset.
 */
export function recyclingBatchFromOriginal(input: {
  original: WorkingBatch;
  originalBaseId: string;
  executionId: string;
  eligibleSourceRows: ReadonlySet<number>;
}): WorkingBatch {
  const records = input.original.dataset.records.filter((record) => input.eligibleSourceRows.has(record.sourceRow));
  const dataset: ImportedDataset = {
    ...input.original.dataset,
    fileName: `RECICLADA_${input.original.fileName}`,
    columns: [...input.original.dataset.columns],
    records: records.map((record) => ({ ...record, cells: [...record.cells] })),
  };
  const batch = createWorkingBatch(dataset);
  batch.kind = "RECICLADA";
  batch.originalBaseCode = input.original.code ?? input.original.originalBaseCode ?? null;
  batch.originalBaseId = input.originalBaseId;
  batch.recyclingExecutionId = input.executionId;
  batch.displayName = `Reciclada · ${input.original.displayName ?? input.original.fileName}`;
  batch.receivedAt = input.original.receivedAt;
  batch.provenanceBySourceRow = Object.fromEntries(records.map((record) => [record.sourceRow, input.original.provenanceBySourceRow[record.sourceRow] ?? "EXCEL"]));
  batch.cleaning = {
    validRecords: records.map((record) => ({ ...record, normalizedMobile: record.mobile } as ValidRecord)),
    excludedRecords: [],
    reasonBreakdown: { telefono_vacio: 0, telefono_fijo: 0, telefono_invalido: 0, nombre_vacio: 0, telefono_duplicado: 0 },
  };
  const output: EnrichmentOutput | null = input.original.enrichmentOutput
    ? { columns: [...input.original.enrichmentOutput.columns], rows: input.original.enrichmentOutput.rows.filter((row) => input.eligibleSourceRows.has(row.sourceRow)).map((row) => ({ sourceRow: row.sourceRow, cells: [...row.cells] })) }
    : null;
  batch.enrichmentOutput = output;
  batch.campaignFilters = { ...input.original.campaignFilters };
  batch.distribution = defaultDistributionSettings();
  batch.recyclingHistory = null;
  return batch;
}
