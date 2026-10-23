import { normalizeSpanishMobile } from "../excel/cleaning.ts";
import type { ImportedDataset, ValidRecord } from "../excel/types.ts";
import { createWorkingBatch, defaultDistributionSettings, type WorkingBatch } from "../workspace/batch.ts";

export const candidateTipifications = ["NO RESPONDE", "BUZON DE VOZ"] as const;
export const followUpTipifications = ["AGENDADO"] as const;
export const knownTipifications = [...candidateTipifications, ...followUpTipifications, "CORTA LLAMADA", "LLAMARA A SU COMPAÑIA", "CONOCE EL METODO", "IRA A TIENDA", "OPERADOR INCORRECTO", "DESCONFIA DE LA LLAMADA", "TITULAR INCORRECTO"] as const;

export type RecyclingBucket = "candidato" | "seguimiento" | "revision" | "bloqueado";
export interface RecyclingRecord { mobile: string; sourceRow: number; cells: string[]; fileName: string; date: string; tipification: string; bucket: RecyclingBucket; reviewReason?: string }
export interface RecyclingAnalysis { columns: string[]; records: RecyclingRecord[]; winners: RecyclingRecord[]; counts: Record<RecyclingBucket | "duplicados", number>; tipifications: Record<string, number>; files: string[] }

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

export function analyzeRecyclingFiles(inputs: { fileName: string; columns: string[]; rows: string[][] }[]): RecyclingAnalysis {
  const all: RecyclingRecord[] = []; const files: string[] = []; const union = new Map<string, number>();
  for (const input of inputs) input.columns.forEach((header) => { if (!union.has(header)) union.set(header, union.size); });
  for (const input of inputs) {
    files.push(input.fileName);
    const mobileIndex = column(input.columns, "mobile"), tipIndex = column(input.columns, "tipification"), dateIndex = column(input.columns, "date"), blockIndex = column(input.columns, "opposition");
    for (const [index, cells] of input.rows.entries()) {
      const mobile = normalizeSpanishMobile(cells[mobileIndex] ?? ""); if (!mobile) continue;
      const tipification = (cells[tipIndex] ?? "").trim().toLocaleUpperCase("es-ES"); const known = knownTipifications.includes(tipification as never);
      const blocked = blockIndex >= 0 && isBlocked(cells[blockIndex] ?? "");
      const aligned = [...union.keys()].map((header) => cells[input.columns.indexOf(header)] ?? "");
      all.push({ mobile, sourceRow: index + 2, cells: aligned, fileName: input.fileName, date: cells[dateIndex] ?? "", tipification, bucket: bucket(tipification, blocked, known), reviewReason: blocked ? "Bloqueo/oposición indicado por el CRM" : blockIndex < 0 ? "El CRM no aporta oposición, bloqueo, venta ni exclusión comercial" : known ? undefined : "Tipificación desconocida" });
    }
  }
  const winnersByMobile = new Map<string, RecyclingRecord>();
  for (const record of all) { const prior = winnersByMobile.get(record.mobile); if (!prior || (record.bucket === "bloqueado" && prior.bucket !== "bloqueado") || (record.bucket !== "bloqueado" && prior.bucket !== "bloqueado" && dateValue(record.date) > dateValue(prior.date))) winnersByMobile.set(record.mobile, record); }
  const winners = [...winnersByMobile.values()]; const counts = { candidato: 0, seguimiento: 0, revision: 0, bloqueado: 0, duplicados: all.length - winners.length };
  const tipifications: Record<string, number> = {}; for (const record of all) { tipifications[record.tipification || "SIN TIPIFICACIÓN"] = (tipifications[record.tipification || "SIN TIPIFICACIÓN"] ?? 0) + 1; } for (const record of winners) counts[record.bucket] += 1;
  return { columns: [...union.keys(), "Archivo origen", "Fila origen", "Móvil normalizado", "Estado reciclaje", "Motivo revisión"], records: all, winners, counts, tipifications, files };
}

export function recyclingToBatch(analysis: RecyclingAnalysis, approved: Set<string>): WorkingBatch {
  const chosen = analysis.winners.filter((record) => record.bucket === "candidato" && approved.has(record.mobile));
  const records = chosen.map((record) => ({ sourceRow: record.sourceRow, cells: [...record.cells, record.fileName, String(record.sourceRow), record.mobile, "Aprobado manualmente", ""], mobile: record.mobile, document: "", name: "", contactPhone: "" }));
  const dataset: ImportedDataset = { fileName: "BASE_RECICLADA.xlsx", columns: analysis.columns, columnMapping: { movil: analysis.columns.indexOf("Móvil normalizado"), enriched: {} }, records };
  const batch = createWorkingBatch(dataset);
  batch.cleaning = { validRecords: records.map((record) => ({ ...record, normalizedMobile: record.mobile } as ValidRecord)), excludedRecords: [], reasonBreakdown: { telefono_vacio: 0, telefono_fijo: 0, telefono_invalido: 0, nombre_vacio: 0, telefono_duplicado: 0 } };
  batch.enrichmentOutput = { columns: dataset.columns, rows: records.map((record) => ({ sourceRow: record.sourceRow, cells: record.cells })) };
  batch.distribution = defaultDistributionSettings(); return batch;
}
