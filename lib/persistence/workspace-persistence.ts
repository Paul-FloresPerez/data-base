import type { CampaignFilters, CampaignOperatorId } from "../campaigns/campaign-engine.ts";
import { buildCampaignReport, campaignOperators } from "../campaigns/campaign-engine.ts";
import { buildExportPlan } from "../export/xlsx-export.ts";
import type { CleaningResult, EnrichmentMode, ExclusionReason, ImportedDataset } from "../excel/types.ts";
import { enrichedFieldHeaders } from "../excel/types.ts";
import { portabilityDateForStorage } from "../excel/portability-date.ts";
import type { BatchKind, DistributionSettings, RecordProvenance, WorkingBatch } from "../workspace/batch.ts";
import type { HlrConsultationMetadata } from "../services/hlr-contract.ts";
import type { StoredRealHlrQueuePlan } from "../services/real-hlr-queue-plan.ts";
import type { HistoricalResultImportSummary } from "../excel/historical-results.ts";

/** Kept below Vercel's request limit; the client sends one chunk at a time. */
export const RECORDS_PER_REQUEST = 100;
export const MAX_RECORDS_PER_BASE = 10_000;
export const MAX_REQUEST_BYTES = 850_000;

export type StoredTipification = "PENDIENTE" | "VALIDO" | "TELEFONO_VACIO" | "TELEFONO_FIJO" | "TELEFONO_INVALIDO" | "NOMBRE_VACIO" | "TELEFONO_DUPLICADO";

export interface StoredRecord {
  sourceRow: number;
  cells: string[];
  mobile: string;
  document: string;
  name: string;
  contactPhone: string;
  normalizedMobile: string | null;
  reason: ExclusionReason | null;
  tipification: StoredTipification;
  enrichedCells: string[] | null;
  provenance: RecordProvenance;
}

export interface StoredMetadata {
  version: 1;
  completed: boolean;
  revision: string | null;
  originalFileName: string;
  columns: string[];
  columnMapping: ImportedDataset["columnMapping"];
  enrichmentColumns: string[] | null;
  enrichmentMode: EnrichmentMode;
  campaignFilters: Omit<CampaignFilters, "asOfDate"> & { asOfDate?: string };
  distribution: DistributionSettings;
  enrichmentSource: "mock" | "crm" | "excel" | "api_real" | null;
  kind?: BatchKind;
  operationalSourceRows?: number[];
  /** Client-side export was actually generated and download started. */
  exportCompletedAt?: string | null;
  realHlrQueue?: StoredRealHlrQueuePlan | null;
  realHlrConsultationsByMobile?: Record<string, HlrConsultationMetadata>;
  historicalResultImport?: HistoricalResultImportSummary | null;
}

export interface SaveStartPayload {
  id: string;
  name: string;
  revision: string;
  expectedRecords: number;
  validRecords: number;
  excludedRecords: number;
  state: "LISTA_PARA_LIMPIAR" | "LISTA_PARA_ENRIQUECER" | "LISTA_PARA_DISTRIBUIR";
  metadata: StoredMetadata;
}

export interface SavedLot {
  campaign: "YOIGO" | "VODAFONE";
  number: number;
  sourceRows: number[];
}

const exclusionToTipification: Record<ExclusionReason, StoredTipification> = {
  telefono_vacio: "TELEFONO_VACIO",
  telefono_fijo: "TELEFONO_FIJO",
  telefono_invalido: "TELEFONO_INVALIDO",
  nombre_vacio: "NOMBRE_VACIO",
  telefono_duplicado: "TELEFONO_DUPLICADO",
};

const tipificationToExclusion: Partial<Record<StoredTipification, ExclusionReason>> = Object.fromEntries(
  Object.entries(exclusionToTipification).map(([reason, tipification]) => [tipification, reason as ExclusionReason]),
);

function newRevision(): string {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function toSerializableFilters(filters: CampaignFilters): StoredMetadata["campaignFilters"] {
  return { ...filters, asOfDate: filters.asOfDate?.toISOString() };
}

function toStoredRecords(batch: WorkingBatch): StoredRecord[] {
  const excluded = new Map(batch.cleaning?.excludedRecords.map((record) => [record.sourceRow, record.reason]) ?? []);
  const valid = new Map(batch.cleaning?.validRecords.map((record) => [record.sourceRow, record.normalizedMobile]) ?? []);
  const enriched = new Map(batch.enrichmentOutput?.rows.map((row) => [row.sourceRow, row.cells]) ?? []);

  const records = [...batch.dataset.records, ...(batch.recyclingHistory?.records ?? [])];
  return records.map((record) => {
    const reason = excluded.get(record.sourceRow) ?? null;
    const normalizedMobile = valid.get(record.sourceRow) ?? null;
    return {
      sourceRow: record.sourceRow,
      cells: [...record.cells],
      mobile: record.mobile,
      document: record.document,
      name: record.name,
      contactPhone: record.contactPhone,
      normalizedMobile,
      reason,
      tipification: reason ? exclusionToTipification[reason] : normalizedMobile ? "VALIDO" : "PENDIENTE",
      enrichedCells: enriched.get(record.sourceRow) ? [...enriched.get(record.sourceRow)!] : null,
      provenance: batch.provenanceBySourceRow[record.sourceRow] ?? "EXCEL",
    };
  });
}

export function serializeBatch(batch: WorkingBatch, name: string): { start: SaveStartPayload; records: StoredRecord[] } {
  const records = toStoredRecords(batch);
  if (records.length > MAX_RECORDS_PER_BASE) {
    throw new Error(`La base supera el límite de ${MAX_RECORDS_PER_BASE.toLocaleString("es-ES")} registros guardables.`);
  }
  const validRecords = batch.cleaning?.validRecords.length ?? 0;
  const excludedRecords = batch.cleaning?.excludedRecords.length ?? 0;
  const state = batch.enrichmentOutput ? "LISTA_PARA_DISTRIBUIR" : batch.cleaning ? "LISTA_PARA_ENRIQUECER" : "LISTA_PARA_LIMPIAR";
  return {
    start: {
      id: batch.id,
      name: name.trim(),
      revision: newRevision(),
      expectedRecords: records.length,
      validRecords,
      excludedRecords,
      state,
      metadata: {
        version: 1,
        completed: false,
        revision: null,
        originalFileName: batch.fileName,
        columns: [...batch.dataset.columns],
        columnMapping: batch.dataset.columnMapping,
        enrichmentColumns: batch.enrichmentOutput ? [...batch.enrichmentOutput.columns] : null,
        enrichmentMode: "preserve",
        campaignFilters: toSerializableFilters(batch.campaignFilters),
        distribution: { ...batch.distribution, selectedCampaigns: [...batch.distribution.selectedCampaigns] },
        enrichmentSource: batch.enrichmentOutput
          ? records.some((record) => record.provenance === "MOCK")
            ? "mock"
            : records.some((record) => record.provenance === "CRM")
              ? "crm"
              : records.some((record) => record.provenance === "API_REAL")
                ? "api_real"
                : "excel"
          : null,
        kind: batch.kind,
        operationalSourceRows: batch.kind === "RECICLADA" ? batch.dataset.records.map((record) => record.sourceRow) : undefined,
        exportCompletedAt: batch.exportCompletedAt,
        realHlrQueue: batch.realHlrQueue,
        realHlrConsultationsByMobile: batch.realHlrConsultationsByMobile,
        historicalResultImport: batch.historicalResultImport,
      },
    },
    records,
  };
}

export function splitRecords(records: StoredRecord[]): StoredRecord[][] {
  const result: StoredRecord[][] = [];
  for (let index = 0; index < records.length; index += RECORDS_PER_REQUEST) {
    const chunk = records.slice(index, index + RECORDS_PER_REQUEST);
    if (new TextEncoder().encode(JSON.stringify({ records: chunk })).byteLength > MAX_REQUEST_BYTES) {
      throw new Error("Una parte de la base supera el límite de tamaño permitido.");
    }
    result.push(chunk);
  }
  return result;
}

export function buildStoredLots(batch: WorkingBatch): SavedLot[] {
  if (!batch.enrichmentOutput) return [];
  const report = buildCampaignReport(batch.enrichmentOutput, campaignOperators, batch.campaignFilters);
  const plan = buildExportPlan(report, batch.distribution.selectedCampaigns, batch.distribution.batchSize);
  return plan.campaigns.flatMap((campaign) => campaign.batches.map((lot) => ({
    campaign: campaign.campaign.toUpperCase() as "YOIGO" | "VODAFONE",
    number: lot.index,
    sourceRows: lot.rows.map((row) => row.sourceRow),
  })));
}

export interface LoadedRecord extends StoredRecord { id: string }
export interface LoadedBase { id: string; name: string; createdAt: string; metadata: StoredMetadata; records: LoadedRecord[] }

export function restoreBatch(base: LoadedBase): WorkingBatch {
  const records = [...base.records].sort((a, b) => a.sourceRow - b.sourceRow);
  const operationalRows = new Set(base.metadata.operationalSourceRows ?? records.map((record) => record.sourceRow));
  const operationalRecords = records.filter((record) => operationalRows.has(record.sourceRow));
  const dataset: ImportedDataset = {
    fileName: base.metadata.originalFileName,
    columns: [...base.metadata.columns],
    columnMapping: base.metadata.columnMapping,
    records: operationalRecords.map(({ sourceRow, cells, mobile, document, name, contactPhone }) => ({ sourceRow, cells, mobile, document, name, contactPhone })),
  };
  const validRecords = operationalRecords.filter((record) => record.tipification === "VALIDO").map(({ sourceRow, cells, mobile, document, name, contactPhone, normalizedMobile }) => ({ sourceRow, cells, mobile, document, name, contactPhone, normalizedMobile: normalizedMobile ?? "" }));
  const excludedRecords = operationalRecords.flatMap((record) => {
    const reason = record.reason ?? tipificationToExclusion[record.tipification];
    return reason ? [{ sourceRow: record.sourceRow, cells: record.cells, mobile: record.mobile, document: record.document, name: record.name, contactPhone: record.contactPhone, reason }] : [];
  });
  const reasonBreakdown: CleaningResult["reasonBreakdown"] = { telefono_vacio: 0, telefono_fijo: 0, telefono_invalido: 0, nombre_vacio: 0, telefono_duplicado: 0 };
  for (const record of excludedRecords) reasonBreakdown[record.reason] += 1;
  const filters = { ...base.metadata.campaignFilters, asOfDate: base.metadata.campaignFilters.asOfDate ? new Date(base.metadata.campaignFilters.asOfDate) : undefined };
  return {
    id: base.id,
    kind: base.metadata.kind ?? "ORIGINAL",
    fileName: base.metadata.originalFileName,
    displayName: base.name,
    createdAt: base.createdAt,
    dataset,
    cleaning: operationalRecords.some((record) => record.tipification !== "PENDIENTE") ? { validRecords, excludedRecords, reasonBreakdown } : null,
    enrichmentOutput: base.metadata.enrichmentColumns ? { columns: base.metadata.enrichmentColumns, rows: operationalRecords.flatMap((record) => record.enrichedCells ? [{ sourceRow: record.sourceRow, cells: record.enrichedCells }] : []) } : null,
    historicalResultImport: base.metadata.historicalResultImport ?? null,
    exportCompletedAt: base.metadata.exportCompletedAt ?? null,
    provenanceBySourceRow: Object.fromEntries(records.map((record) => [record.sourceRow, record.provenance ?? "EXCEL"])),
    realHlrQueue: base.metadata.realHlrQueue ?? null,
    realHlrConsultationsByMobile: base.metadata.realHlrConsultationsByMobile ?? {},
    recyclingHistory: base.metadata.kind === "RECICLADA" ? { ...dataset, records: records.filter((record) => !operationalRows.has(record.sourceRow)).map(({ sourceRow, cells, mobile, document, name, contactPhone }) => ({ sourceRow, cells, mobile, document, name, contactPhone })) } : null,
    campaignFilters: filters,
    distribution: { ...base.metadata.distribution, selectedCampaigns: [...base.metadata.distribution.selectedCampaigns] as CampaignOperatorId[] },
  };
}

export function enrichmentScalars(cells: string[] | null, columns: string[]) {
  if (!cells) return { operadorActual: null, operadorOriginal: null, fechaPortabilidad: null };
  const field = (name: keyof typeof enrichedFieldHeaders) => cells[columns.indexOf(enrichedFieldHeaders[name])] ?? null;
  const rawDate = portabilityDateForStorage(field("fecha_portabilidad"));
  const date = rawDate ? new Date(`${rawDate}T00:00:00.000Z`) : null;
  return { operadorActual: field("operador_actual"), operadorOriginal: field("operador_origen"), fechaPortabilidad: date };
}
