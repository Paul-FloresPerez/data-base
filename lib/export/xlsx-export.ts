import type JSZip from "jszip";
import type { WorkBook } from "xlsx";

import type { CampaignBreakdown, CampaignOperatorId, CampaignReport } from "@/lib/campaigns/campaign-engine";
import type { EnrichmentOutput, EnrichmentOutputRow } from "@/lib/excel/types";

export const DEFAULT_BATCH_SIZE = 100;
export const MAX_BATCH_SIZE = 100;

export interface CampaignBatch {
  fileName: string;
  index: number;
  rows: EnrichmentOutputRow[];
}

export interface CampaignExportPlan {
  batches: CampaignBatch[];
  campaign: CampaignOperatorId;
  eligibleCount: number;
  folderName: string;
}

export interface ExportPlan {
  campaigns: CampaignExportPlan[];
  totalEligible: number;
}

function uniqueRows(rows: readonly EnrichmentOutputRow[]): EnrichmentOutputRow[] {
  const sourceRows = new Set<number>();
  const unique: EnrichmentOutputRow[] = [];

  for (const row of rows) {
    if (!sourceRows.has(row.sourceRow)) {
      sourceRows.add(row.sourceRow);
      unique.push(row);
    }
  }

  return unique;
}

function toCampaignRows(campaign: CampaignBreakdown): EnrichmentOutputRow[] {
  return uniqueRows(campaign.eligible);
}

export function normalizeBatchSize(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_BATCH_SIZE;
  }

  return Math.min(MAX_BATCH_SIZE, Math.max(1, Math.floor(value)));
}

export function splitIntoBatches<T>(rows: readonly T[], batchSize: number): T[][] {
  const normalizedBatchSize = normalizeBatchSize(batchSize);
  const batches: T[][] = [];

  for (let start = 0; start < rows.length; start += normalizedBatchSize) {
    batches.push(rows.slice(start, start + normalizedBatchSize));
  }

  return batches;
}

export function buildExportPlan(
  report: CampaignReport,
  selectedCampaigns: readonly CampaignOperatorId[],
  batchSize: number,
): ExportPlan {
  const selectedCampaignsSet = new Set(selectedCampaigns);
  const campaigns = report.campaigns
    .filter((campaign) => selectedCampaignsSet.has(campaign.operator.id))
    .map((campaign) => {
      const rows = toCampaignRows(campaign);
      const folderName = campaign.operator.id.toLocaleUpperCase("es-ES");
      const batches = splitIntoBatches(rows, batchSize).map((batchRows, index) => ({
        index: index + 1,
        fileName: `LOTE_${String(index + 1).padStart(3, "0")}.xlsx`,
        rows: batchRows,
      }));

      return {
        campaign: campaign.operator.id,
        folderName,
        eligibleCount: rows.length,
        batches,
      };
    });

  return {
    campaigns,
    totalEligible: campaigns.reduce((total, campaign) => total + campaign.eligibleCount, 0),
  };
}

function createTextWorksheet(
  xlsx: typeof import("xlsx"),
  columns: readonly string[],
  rows: readonly EnrichmentOutputRow[],
) {
  const worksheet = xlsx.utils.aoa_to_sheet([
    [...columns],
    ...rows.map((row) => columns.map((_, index) => String(row.cells[index] ?? ""))),
  ]);

  const range = xlsx.utils.decode_range(worksheet["!ref"] ?? "A1:A1");
  for (let rowIndex = range.s.r; rowIndex <= range.e.r; rowIndex += 1) {
    for (let columnIndex = range.s.c; columnIndex <= range.e.c; columnIndex += 1) {
      const address = xlsx.utils.encode_cell({ r: rowIndex, c: columnIndex });
      const cell = worksheet[address];

      if (cell) {
        cell.t = "s";
        cell.v = String(cell.v ?? "");
        delete cell.f;
      }
    }
  }

  return worksheet;
}

export function createXlsxWorkbook(
  xlsx: typeof import("xlsx"),
  columns: readonly string[],
  rows: readonly EnrichmentOutputRow[],
  sheetName = "Registros",
): WorkBook {
  const workbook = xlsx.utils.book_new();
  const worksheet = createTextWorksheet(xlsx, columns, rows);
  xlsx.utils.book_append_sheet(workbook, worksheet, sheetName.slice(0, 31));
  return workbook;
}

export function createCompleteWorkbook(
  xlsx: typeof import("xlsx"),
  output: EnrichmentOutput,
): WorkBook {
  return createXlsxWorkbook(xlsx, output.columns, output.rows, "Base completa");
}

export function workbookToArray(
  xlsx: typeof import("xlsx"),
  workbook: WorkBook,
): ArrayBuffer {
  return xlsx.write(workbook, { bookType: "xlsx", type: "array", compression: true }) as ArrayBuffer;
}

export async function createCampaignZip(
  xlsx: typeof import("xlsx"),
  zip: JSZip,
  columns: readonly string[],
  plan: ExportPlan,
  onProgress?: (completedBatches: number, totalBatches: number) => void,
): Promise<Blob> {
  const totalBatches = plan.campaigns.reduce((total, campaign) => total + campaign.batches.length, 0);
  let completedBatches = 0;

  for (const campaign of plan.campaigns) {
    const folder = zip.folder(campaign.folderName);
    if (!folder) {
      throw new Error(`No se pudo preparar la carpeta ${campaign.folderName}.`);
    }

    for (const batch of campaign.batches) {
      const workbook = createXlsxWorkbook(xlsx, columns, batch.rows, campaign.folderName);
      folder.file(batch.fileName, workbookToArray(xlsx, workbook));
      completedBatches += 1;
      onProgress?.(completedBatches, totalBatches);
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  }

  return zip.generateAsync({ type: "blob", compression: "DEFLATE" });
}
