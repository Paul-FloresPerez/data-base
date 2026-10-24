import { campaignOperators, type CampaignFilters, type CampaignOperatorId } from "../campaigns/campaign-engine.ts";
import type { CleaningResult, EnrichmentOutput, ImportedDataset } from "../excel/types.ts";

export type BatchStatus = "lista_para_limpiar" | "lista_para_enriquecer" | "lista_para_distribuir";
export type BatchKind = "ORIGINAL" | "RECICLADA";
export type ProcessingModule = "importacion" | "limpieza" | "enriquecimiento" | "campanas" | "distribucion" | "exportacion";

export interface DistributionSettings {
  batchSize: number;
  selectedCampaigns: CampaignOperatorId[];
}

/** Source of the enrichment data for each record. It is never inferred from a UI label. */
export type RecordProvenance = "EXCEL" | "CRM" | "MOCK" | "API_REAL";

export interface WorkingBatch {
  campaignFilters: CampaignFilters;
  cleaning: CleaningResult | null;
  createdAt: string;
  dataset: ImportedDataset;
  /** User-facing name, kept apart from the immutable original file name. */
  displayName?: string;
  distribution: DistributionSettings;
  enrichmentOutput: EnrichmentOutput | null;
  /** Set only after an export file is successfully generated and download is initiated locally. */
  exportCompletedAt: string | null;
  fileName: string;
  id: string;
  kind: BatchKind;
  provenanceBySourceRow: Record<number, RecordProvenance>;
  /** Historical CRM managements retained for audit, never used for campaigns or export. */
  recyclingHistory: ImportedDataset | null;
}

export interface BatchSummary {
  createdAt: string;
  displayName?: string;
  fileName: string;
  id: string;
  kind: BatchKind;
  records: number;
  status: BatchStatus;
}

export const defaultCampaignFilters: CampaignFilters = {
  includeWithoutPortabilityDate: true,
};

export const defaultDistributionSettings = (): DistributionSettings => ({
  batchSize: 100,
  selectedCampaigns: [...campaignOperators],
});

function createBatchId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (character) => {
    const random = Math.floor(Math.random() * 16);
    const value = character === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

export function createWorkingBatch(
  dataset: ImportedDataset,
  id = createBatchId(),
  createdAt = new Date().toISOString(),
): WorkingBatch {
  return {
    id,
    kind: "ORIGINAL",
    fileName: dataset.fileName,
    displayName: dataset.fileName.replace(/\.xlsx$/i, ""),
    createdAt,
    dataset,
    cleaning: null,
    enrichmentOutput: null,
    exportCompletedAt: null,
    provenanceBySourceRow: Object.fromEntries(dataset.records.map((record) => [record.sourceRow, "EXCEL"])),
    recyclingHistory: null,
    campaignFilters: { ...defaultCampaignFilters },
    distribution: defaultDistributionSettings(),
  };
}

export function getBatchStatus(batch: WorkingBatch): BatchStatus {
  if (batch.enrichmentOutput) {
    return "lista_para_distribuir";
  }

  if (batch.cleaning) {
    return "lista_para_enriquecer";
  }

  return "lista_para_limpiar";
}

export function summarizeBatch(batch: WorkingBatch): BatchSummary {
  return {
    id: batch.id,
    fileName: batch.fileName,
    displayName: batch.displayName,
    createdAt: batch.createdAt,
    records: batch.dataset.records.length,
    kind: batch.kind,
    status: getBatchStatus(batch),
  };
}

/** Keeps the processing entry point stable when the user moves through primary navigation. */
export function getProcessingModule(batch: WorkingBatch | null, current: ProcessingModule | null = null): ProcessingModule {
  if (!batch) return "importacion";
  if (current === "distribucion" || current === "exportacion") return current;
  if (!batch.cleaning) return "limpieza";
  if (!batch.enrichmentOutput) return "enriquecimiento";
  return "campanas";
}
