import { campaignOperators, type CampaignFilters, type CampaignOperatorId } from "../campaigns/campaign-engine.ts";
import type { CleaningResult, EnrichmentOutput, ImportedDataset } from "../excel/types.ts";

export type BatchStatus = "lista_para_limpiar" | "lista_para_enriquecer" | "lista_para_distribuir";

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
  distribution: DistributionSettings;
  enrichmentOutput: EnrichmentOutput | null;
  fileName: string;
  id: string;
  provenanceBySourceRow: Record<number, RecordProvenance>;
}

export interface BatchSummary {
  createdAt: string;
  fileName: string;
  id: string;
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
    fileName: dataset.fileName,
    createdAt,
    dataset,
    cleaning: null,
    enrichmentOutput: null,
    provenanceBySourceRow: Object.fromEntries(dataset.records.map((record) => [record.sourceRow, "EXCEL"])),
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
    createdAt: batch.createdAt,
    records: batch.dataset.records.length,
    status: getBatchStatus(batch),
  };
}
