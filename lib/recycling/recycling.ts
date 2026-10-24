import { normalizeSpanishMobile } from "../excel/cleaning.ts";
import type { ImportedDataset, ValidRecord } from "../excel/types.ts";
import { createWorkingBatch, defaultDistributionSettings, type WorkingBatch } from "../workspace/batch.ts";

export const candidateTipifications = ["NO RESPONDE", "BUZON DE VOZ", "CORTA LLAMADA"] as const;
export const followUpTipifications = ["AGENDADO"] as const;
export const knownTipifications = [...candidateTipifications, ...followUpTipifications, "LLAMARA A SU COMPAÑIA", "CONOCE EL METODO", "IRA A TIENDA", "OPERADOR INCORRECTO", "DESCONFIA DE LA LLAMADA", "TITULAR INCORRECTO"] as const;

export type RecyclingBucket = "candidato" | "seguimiento" | "revision" | "bloqueado";
export interface RecyclingInput { fileName: string; zipName?: string; internalPath?: string; sheetName?: string; columns: string[]; rows: string[][] }
export interface RecyclingRecord { mobile: string; sourceRow: number; originRow: number; sheetName: string; cells: string[]; fileName: string; zipName?: string; internalPath?: string; date: string; tipification: string; bucket: RecyclingBucket; reviewReason?: string }
export interface RecyclingAnalysis { columns: string[]; records: RecyclingRecord[]; winners: RecyclingRecord[]; counts: Record<RecyclingBucket | "duplicados" | "moviles", number>; tipifications: Record<string, number>; files: string[] }

const aliases: Record<string, string[]> = {
  mobile: ["telefonomovil", "telefonosmovil", "movil", "móvil", "celular"],
  tipification: ["tipificacion", "tipificación", "resultado"],
  date: ["fecha", "fechagestion", "fecha gestión", "fecha instalacion", "fechainstalacion"],
  opposition: ["oposicion", "oposición", "bloqueado", "bloqueo", "venta", "exclusion comercial", "exclusión comercial", "no llamar"],
};
const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es-ES").replace(/[^a-z0-9]/g, "");
function column(columns: string[], field: keyof typeof aliases) { return columns.findIndex((header) => aliases[field].includes(normalize(header))); }
function dateValue(value: string) { const time = Date.parse(value); return Number.isFinite(time) ? time : -1; }
function isBlocked(value: string) { return /\b(si|sí|true)\b|bloque|oposici|venta|exclu|no llamar/i.test(value); }
function bucket(tipification: string, blocked: boolean, known: boolean): RecyclingBucket {
  if (blocked) return "bloqueado";
  if (candidateTipifications.includes(tipification as never)) return "candidato";
  if (followUpTipifications.includes(tipification as never)) return "seguimiento";
  return known ? "revision" : "revision";
}

export function analyzeRecyclingFiles(inputs: RecyclingInput[]): RecyclingAnalysis {
  const all: RecyclingRecord[] = []; const files: string[] = []; const union = new Map<string, number>(); let internalRow = 2;
  for (const input of inputs) input.columns.forEach((header) => { if (!union.has(header)) union.set(header, union.size); });
  for (const input of inputs) {
    files.push(input.fileName);
    const mobileIndex = column(input.columns, "mobile"), tipIndex = column(input.columns, "tipification"), dateIndex = column(input.columns, "date"), blockIndex = column(input.columns, "opposition");
    for (const [index, cells] of input.rows.entries()) {
      const mobile = normalizeSpanishMobile(cells[mobileIndex] ?? ""); if (!mobile) continue;
      const tipification = (cells[tipIndex] ?? "").trim().toLocaleUpperCase("es-ES"); const known = knownTipifications.includes(tipification as never);
      const blocked = blockIndex >= 0 && isBlocked(cells[blockIndex] ?? "");
      const aligned = [...union.keys()].map((header) => cells[input.columns.indexOf(header)] ?? "");
      all.push({ mobile, sourceRow: internalRow++, originRow: index + 2, sheetName: input.sheetName ?? "Datos", cells: aligned, fileName: input.fileName, zipName: input.zipName, internalPath: input.internalPath, date: cells[dateIndex] ?? "", tipification, bucket: bucket(tipification, blocked, known), reviewReason: blocked ? "Bloqueo/oposición indicado por el CRM" : blockIndex < 0 ? "El CRM no aporta oposición, bloqueo, venta ni exclusión comercial" : known ? undefined : "Tipificación desconocida" });
    }
  }
  const winnersByMobile = new Map<string, RecyclingRecord>();
  for (const record of all) { const prior = winnersByMobile.get(record.mobile); if (!prior || (record.bucket === "bloqueado" && prior.bucket !== "bloqueado") || (record.bucket !== "bloqueado" && prior.bucket !== "bloqueado" && dateValue(record.date) > dateValue(prior.date))) winnersByMobile.set(record.mobile, record); }
  const winners = [...winnersByMobile.values()]; const counts = { candidato: 0, seguimiento: 0, revision: 0, bloqueado: 0, duplicados: all.length - winners.length, moviles: winners.length };
  const tipifications: Record<string, number> = {}; for (const record of all) { tipifications[record.tipification || "SIN TIPIFICACIÓN"] = (tipifications[record.tipification || "SIN TIPIFICACIÓN"] ?? 0) + 1; } for (const record of winners) counts[record.bucket] += 1;
  return { columns: [...union.keys(), "ZIP origen", "Ruta interna", "Archivo origen", "Hoja origen", "Fila origen", "Móvil normalizado", "Procedencia", "Estado reciclaje", "Motivo revisión"], records: all, winners, counts, tipifications, files };
}

export function recyclingToBatch(analysis: RecyclingAnalysis, selectedTipifications: Set<string>): WorkingBatch {
  const toImportedRecord = (record: RecyclingRecord) => ({ sourceRow: record.sourceRow, cells: [...record.cells, record.zipName ?? "", record.internalPath ?? "", record.fileName, record.sheetName, String(record.originRow), record.mobile, "CRM", record.bucket, record.reviewReason ?? ""], mobile: record.mobile, document: "", name: "", contactPhone: "" });
  const selected = analysis.winners.filter((record) => record.bucket !== "bloqueado" && selectedTipifications.has(record.tipification));
  const selectedRows = new Set(selected.map((record) => record.sourceRow));
  const dataset: ImportedDataset = { fileName: "BASE_RECICLADA.xlsx", columns: analysis.columns, columnMapping: { movil: analysis.columns.indexOf("Móvil normalizado"), enriched: {} }, records: selected.map(toImportedRecord) };
  const batch = createWorkingBatch(dataset);
  batch.kind = "RECICLADA";
  batch.provenanceBySourceRow = Object.fromEntries(analysis.records.map((record) => [record.sourceRow, "CRM"]));
  batch.recyclingHistory = { ...dataset, records: analysis.records.filter((record) => !selectedRows.has(record.sourceRow)).map(toImportedRecord) };
  batch.cleaning = { validRecords: dataset.records.map((record) => ({ ...record, normalizedMobile: record.mobile } as ValidRecord)), excludedRecords: [], reasonBreakdown: { telefono_vacio: 0, telefono_fijo: 0, telefono_invalido: 0, nombre_vacio: 0, telefono_duplicado: 0 } };
  batch.enrichmentOutput = { columns: dataset.columns, rows: batch.cleaning.validRecords.map((record) => ({ sourceRow: record.sourceRow, cells: record.cells })) };
  batch.distribution = defaultDistributionSettings(); return batch;
}
