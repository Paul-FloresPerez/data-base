import { normalizeSpanishMobile } from "./cleaning.ts";
import { datePartsFromPortability } from "./portability-date.ts";
import { MAX_LOCAL_XLSX_BYTES, normalizeColumnName } from "./import-excel.ts";
import type { CleaningResult, EnrichmentOutput, ImportedDataset } from "./types.ts";

export type ExternalResultField = "movil" | "movil_alternativo" | "operador_actual" | "operador_origen" | "portabilidad_desde" | "fecha_portabilidad";
export type ExternalResultMapping = Partial<Record<ExternalResultField, number>> & { movil: number };

export interface ExternalResultsDataset {
  fileName: string;
  columns: string[];
  rows: string[][];
  contentHash: string;
}

export interface ExternalResultsImportSummary {
  importId: string;
  importedAt: string;
  sourceFileName: string;
  sourceColumns: string[];
  contentHash: string;
  matched: number;
  applied: number;
  unchanged: number;
  missingForBase: number;
  resultsWithoutBase: number;
  invalidResults: number;
  duplicateResults: number;
  identifierConflicts: number;
  contradictions: number;
}

export interface ExternalResultsMerge {
  output: EnrichmentOutput;
  summary: ExternalResultsImportSummary;
  requiresOverwriteConfirmation: boolean;
}

export class ExternalResultsImportError extends Error {
  constructor(message: string) { super(message); this.name = "ExternalResultsImportError"; }
}

const aliases: Record<ExternalResultField, readonly string[]> = {
  movil: ["telefonomovil", "telefonosmovil", "movil", "celular", "nums", "numeroemitido"],
  movil_alternativo: ["numerocompleto"],
  operador_actual: ["operadoractual", "operador", "operadorvigente"],
  operador_origen: ["operadororiginal", "operadororigen"],
  portabilidad_desde: ["portabilidaddesde", "operadordonante"],
  fecha_portabilidad: ["fechaportabilidad", "fechadeportabilidad"],
};

export function suggestExternalResultMapping(columns: readonly string[]): Partial<ExternalResultMapping> {
  const result: Partial<ExternalResultMapping> = {};
  for (const [index, column] of columns.entries()) {
    const normalized = normalizeColumnName(column);
    for (const [field, names] of Object.entries(aliases) as [ExternalResultField, readonly string[]][]) {
      if (result[field] === undefined && names.includes(normalized)) result[field] = index;
    }
  }
  return result;
}

function value(row: readonly string[], index: number | undefined) { return index === undefined ? "" : (row[index] ?? "").trim(); }
function createImportId() { return typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `externo-${Date.now()}`; }

async function sha256(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(digest)].map((part) => part.toString(16).padStart(2, "0")).join("");
}

export async function importExternalResultsFile(file: File): Promise<ExternalResultsDataset> {
  if (!/\.xlsx$/i.test(file.name)) throw new ExternalResultsImportError("Selecciona un archivo XLSX de resultados externos.");
  if (file.size > MAX_LOCAL_XLSX_BYTES) throw new ExternalResultsImportError("El archivo de resultados supera el límite local de 25 MB.");
  try {
    const [xlsx, buffer] = await Promise.all([import("xlsx"), file.arrayBuffer()]);
    const workbook = xlsx.read(buffer, { type: "array" });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName || !workbook.Sheets[sheetName]) throw new ExternalResultsImportError("El archivo no contiene una hoja legible.");
    const rows = xlsx.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], { header: 1, defval: "", raw: false, blankrows: false });
    const columns = (rows[0] ?? []).map((cell) => String(cell ?? ""));
    if (!columns.length || columns.every((column) => !column.trim())) throw new ExternalResultsImportError("El archivo de resultados no contiene encabezados.");
    return { fileName: file.name, columns, rows: rows.slice(1).filter((row) => row.some((cell) => String(cell ?? "").trim())).map((row) => columns.map((_, index) => String(row[index] ?? ""))), contentHash: await sha256(buffer) };
  } catch (error) {
    if (error instanceof ExternalResultsImportError) throw error;
    throw new ExternalResultsImportError("No se pudo leer el XLSX de resultados externos.");
  }
}

/** Merge only the six approved commercial columns of the master template. */
export function mergeExternalEnrichmentResults(input: {
  dataset: ImportedDataset;
  cleaning: CleaningResult;
  results: ExternalResultsDataset;
  mapping: ExternalResultMapping;
  existingOutput?: EnrichmentOutput | null;
  confirmOverwrite?: boolean;
}): ExternalResultsMerge {
  const required = ["operador_actual", "operador_origen", "portabilidad_desde", "fecha_portabilidad", "anio", "mes"] as const;
  const target = Object.fromEntries(required.map((field) => [field, input.dataset.columnMapping.enriched[field]])) as Record<(typeof required)[number], number | undefined>;
  if (Object.values(target).some((index) => index === undefined)) throw new ExternalResultsImportError("La base ORIGINAL debe conservar las columnas comerciales Operador Actual, Operador Original, Portabilidad Desde, Fecha Portabilidad, Año y Mes.");
  if (!Number.isInteger(input.mapping.movil)) throw new ExternalResultsImportError("Selecciona inequívocamente la columna de móvil de resultados.");

  const parsed = new Map<string, Record<ExternalResultField, string>>(); const duplicates = new Set<string>(); let invalidResults = 0; let identifierConflicts = 0;
  for (const row of input.results.rows) {
    const primary = normalizeSpanishMobile(value(row, input.mapping.movil));
    const alternative = normalizeSpanishMobile(value(row, input.mapping.movil_alternativo));
    if (primary && alternative && primary !== alternative) { identifierConflicts += 1; continue; }
    const mobile = primary ?? alternative;
    if (!mobile) { invalidResults += 1; continue; }
    if (parsed.has(mobile)) { parsed.delete(mobile); duplicates.add(mobile); continue; }
    if (duplicates.has(mobile)) continue;
    parsed.set(mobile, {
      movil: mobile,
      movil_alternativo: alternative ?? "",
      operador_actual: value(row, input.mapping.operador_actual),
      operador_origen: value(row, input.mapping.operador_origen),
      portabilidad_desde: value(row, input.mapping.portabilidad_desde),
      fecha_portabilidad: value(row, input.mapping.fecha_portabilidad),
    });
  }
  const baseByMobile = new Map(input.cleaning.validRecords.map((record) => [record.normalizedMobile, record]));
  const oldRows = new Map(input.existingOutput?.rows.map((row) => [row.sourceRow, row.cells]) ?? []);
  let matched = 0, applied = 0, unchanged = 0, contradictions = 0;
  let needsConfirmation = false;
  const resultRows = input.cleaning.validRecords.map((record) => {
    const cells = [...(oldRows.get(record.sourceRow) ?? record.cells)];
    const incoming = parsed.get(record.normalizedMobile);
    if (!incoming) return { sourceRow: record.sourceRow, cells };
    matched += 1;
    const parts = datePartsFromPortability(incoming.fecha_portabilidad);
    const replacements: [number, string][] = [
      [target.operador_actual!, incoming.operador_actual], [target.operador_origen!, incoming.operador_origen], [target.portabilidad_desde!, incoming.portabilidad_desde], [target.fecha_portabilidad!, incoming.fecha_portabilidad], [target.anio!, parts.anio], [target.mes!, parts.mes],
    ];
    const conflict = replacements.some(([index, next]) => Boolean(next) && Boolean(cells[index]?.trim()) && cells[index].trim() !== next);
    if (conflict && !input.confirmOverwrite) { contradictions += 1; needsConfirmation = true; return { sourceRow: record.sourceRow, cells }; }
    const changed = replacements.some(([index, next]) => Boolean(next) && cells[index] !== next);
    if (changed) { for (const [index, next] of replacements) if (next) cells[index] = next; applied += 1; } else unchanged += 1;
    return { sourceRow: record.sourceRow, cells };
  });
  return { output: { columns: [...input.dataset.columns], rows: resultRows }, requiresOverwriteConfirmation: needsConfirmation, summary: { importId: createImportId(), importedAt: new Date().toISOString(), sourceFileName: input.results.fileName, sourceColumns: [...input.results.columns], contentHash: input.results.contentHash, matched, applied, unchanged, missingForBase: input.cleaning.validRecords.filter((record) => !parsed.has(record.normalizedMobile)).length, resultsWithoutBase: [...parsed.keys()].filter((mobile) => !baseByMobile.has(mobile)).length, invalidResults, duplicateResults: duplicates.size, identifierConflicts, contradictions } };
}
