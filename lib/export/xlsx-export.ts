import type JSZip from "jszip";
import type { WorkBook } from "xlsx";

import type { CampaignBreakdown, CampaignOperatorId, CampaignReport } from "@/lib/campaigns/campaign-engine";
import { normalizeSpanishMobile } from "../excel/cleaning.ts";
import type { EnrichmentOutput, EnrichmentOutputRow, ImportedDataset } from "@/lib/excel/types";

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
  conflictCount: number;
  totalEligible: number;
  uniqueEligibleCount: number;
}

export interface ExportArchiveContext {
  baseId: string;
  baseName: string;
  /** Human-readable root code when the active base is derived. */
  baseOriginalCode?: string;
  filters: unknown;
  generatedAt: string;
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

function mobileColumnIndex(columns: readonly string[]): number | undefined {
  const index = columns.findIndex((column) => {
    const comparable = column.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es-ES").replace(/[^a-z0-9]/g, "");
    return ["telefonomovil", "telefonosmovil", "movil", "celular", "nums", "numeroemitido"].includes(comparable);
  });
  return index >= 0 ? index : undefined;
}

function contactKey(row: EnrichmentOutputRow, mobileIndex: number | undefined): string {
  const mobile = mobileIndex === undefined ? null : normalizeSpanishMobile(row.cells[mobileIndex] ?? "");
  return mobile ? `mobile:${mobile}` : `row:${row.sourceRow}`;
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

/** A small deterministic PRNG keeps a prepared distribution reproducible from
 * its persisted seed without treating browser order as commercial evidence. */
function seededOrder(rows: readonly EnrichmentOutputRow[], seed: string | undefined): EnrichmentOutputRow[] {
  if (!seed) return [...rows];
  let state = 2166136261;
  for (const character of seed) {
    state ^= character.charCodeAt(0);
    state = Math.imul(state, 16777619);
  }
  const next = () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
  const result = [...rows];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = Math.floor(next() * (index + 1));
    [result[index], result[target]] = [result[target]!, result[index]!];
  }
  return result;
}

export function buildExportPlan(
  report: CampaignReport,
  selectedCampaigns: readonly CampaignOperatorId[],
  batchSize: number,
  shuffleSeed?: string,
): ExportPlan {
  const selectedCampaignsSet = new Set(selectedCampaigns);
  const campaigns = report.campaigns
    .filter((campaign) => selectedCampaignsSet.has(campaign.operator.id))
    .map((campaign) => {
      const rows = seededOrder(toCampaignRows(campaign), shuffleSeed ? `${shuffleSeed}:${campaign.operator.id}` : undefined);
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

  const mobileIndex = mobileColumnIndex(report.columns);
  const campaignByContact = new Map<string, Set<CampaignOperatorId>>();
  for (const campaign of campaigns) for (const batch of campaign.batches) for (const row of batch.rows) {
    const key = contactKey(row, mobileIndex);
    const assigned = campaignByContact.get(key) ?? new Set<CampaignOperatorId>();
    assigned.add(campaign.campaign);
    campaignByContact.set(key, assigned);
  }
  return {
    campaigns,
    conflictCount: [...campaignByContact.values()].filter((assigned) => assigned.size > 1).length,
    totalEligible: campaigns.reduce((total, campaign) => total + campaign.eligibleCount, 0),
    uniqueEligibleCount: campaignByContact.size,
  };
}

/** Rebinds planned source rows to a projection with the same source-row IDs. */
export function projectExportPlan(plan: ExportPlan, output: EnrichmentOutput): ExportPlan {
  const rowsBySourceRow = new Map(output.rows.map((row) => [row.sourceRow, row]));
  return {
    ...plan,
    campaigns: plan.campaigns.map((campaign) => ({
      ...campaign,
      batches: campaign.batches.map((batch) => ({
        ...batch,
        rows: batch.rows.map((row) => {
          const projected = rowsBySourceRow.get(row.sourceRow);
          if (!projected) throw new Error("Un lote contiene una fila que no pertenece a la salida de exportación.");
          return projected;
        }),
      })),
    })),
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

/**
 * Campaigns only receive eligible enriched rows. The master export deliberately
 * retains every imported operational row, including exclusions, and fills any
 * enrichment-only columns with blanks where no enrichment exists.
 */
export function buildMasterOutput(dataset: ImportedDataset, enriched: EnrichmentOutput | null): EnrichmentOutput {
  const columns = enriched?.columns ?? dataset.columns;
  const enrichedByRow = new Map(enriched?.rows.map((row) => [row.sourceRow, row.cells]) ?? []);
  return {
    columns: [...columns],
    rows: dataset.records.map((record) => ({
      sourceRow: record.sourceRow,
      cells: [...(enrichedByRow.get(record.sourceRow) ?? record.cells), ...Array(Math.max(0, columns.length - record.cells.length)).fill("")].slice(0, columns.length),
    })),
  };
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
  output: EnrichmentOutput,
  plan: ExportPlan,
  context: ExportArchiveContext,
  onProgress?: (completedBatches: number, totalBatches: number) => void,
  campaignOutput: EnrichmentOutput = output,
): Promise<Blob> {
  const totalBatches = plan.campaigns.reduce((total, campaign) => total + campaign.batches.length, 0);
  let completedBatches = 0;

  zip.file("BASE_MAESTRA.xlsx", workbookToArray(xlsx, createCompleteWorkbook(xlsx, output)));
  zip.file("MANIFIESTO.xlsx", workbookToArray(xlsx, createManifestWorkbook(xlsx, plan, context)));

  for (const campaign of plan.campaigns) {
    const folder = zip.folder(campaign.folderName);
    if (!folder) {
      throw new Error(`No se pudo preparar la carpeta ${campaign.folderName}.`);
    }

    for (const batch of campaign.batches) {
      const workbook = createXlsxWorkbook(xlsx, campaignOutput.columns, batch.rows, campaign.folderName);
      folder.file(batch.fileName, workbookToArray(xlsx, workbook));
      completedBatches += 1;
      onProgress?.(completedBatches, totalBatches);
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  }

  return zip.generateAsync({ type: "blob", compression: "DEFLATE" });
}

/** A campaign-only archive never includes contacts from another campaign. */
export async function createSingleCampaignZip(
  xlsx: typeof import("xlsx"),
  zip: JSZip,
  output: EnrichmentOutput,
  campaign: CampaignExportPlan,
  context: ExportArchiveContext,
  onProgress?: (completedBatches: number, totalBatches: number) => void,
): Promise<Blob> {
  zip.file("MANIFIESTO.xlsx", workbookToArray(xlsx, createManifestWorkbook(xlsx, { campaigns: [campaign], totalEligible: campaign.eligibleCount, uniqueEligibleCount: campaign.eligibleCount, conflictCount: 0 }, context)));
  const folder = zip.folder(campaign.folderName);
  if (!folder) throw new Error(`No se pudo preparar la carpeta ${campaign.folderName}.`);
  let completed = 0;
  for (const batch of campaign.batches) {
    folder.file(batch.fileName, workbookToArray(xlsx, createXlsxWorkbook(xlsx, output.columns, batch.rows, campaign.folderName)));
    completed += 1;
    onProgress?.(completed, campaign.batches.length);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  return zip.generateAsync({ type: "blob", compression: "DEFLATE" });
}

export function createManifestWorkbook(
  xlsx: typeof import("xlsx"),
  plan: ExportPlan,
  context: ExportArchiveContext,
): WorkBook {
  const workbook = xlsx.utils.book_new();
  const lotRows: EnrichmentOutputRow[] = plan.campaigns.flatMap((campaign) => campaign.batches.map((batch) => ({
    sourceRow: batch.index,
    cells: [context.baseOriginalCode ?? context.baseId, context.baseName, context.generatedAt, campaign.folderName, String(batch.index), batch.fileName, String(batch.rows.length), "GENERADO"],
  })));
  const indicatorRows: EnrichmentOutputRow[] = [
    ["Código de base original", context.baseOriginalCode ?? context.baseId],
    ["Base activa", context.baseName],
    ["Generado", context.generatedAt],
    ["Móviles únicos", String(plan.uniqueEligibleCount)],
    ["Asignaciones por campaña", String(plan.totalEligible)],
    ["Conflictos entre campañas", String(plan.conflictCount)],
    ["Filtros", JSON.stringify(context.filters)],
  ].map(([field, value], index) => ({ sourceRow: index + 1, cells: [field, value] }));
  xlsx.utils.book_append_sheet(workbook, createTextWorksheet(xlsx, ["Código de base original", "Nombre", "Fecha", "Campaña", "Lote", "Archivo", "Cantidad de registros", "Estado"], lotRows), "Lotes");
  xlsx.utils.book_append_sheet(workbook, createTextWorksheet(xlsx, ["Indicador", "Valor"], indicatorRows), "Indicadores");
  return workbook;
}
