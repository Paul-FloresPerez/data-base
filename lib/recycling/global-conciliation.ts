import { normalizeComparableValue, normalizeOperator } from "../campaigns/campaign-engine.ts";

export type GlobalConciliationRecord = {
  documento: string | null;
  nombre: string | null;
  operadorActual: string | null;
  fechaPortabilidad: Date | null;
  provenance: string;
};

export type MaterialConflictField = "DOCUMENTO" | "IDENTIDAD" | "OPERADOR_ACTUAL" | "FECHA_PORTABILIDAD";

function comparable(value: string | null): string | null {
  if (!value?.trim()) return null;
  const normalized = normalizeComparableValue(value);
  return normalized || null;
}

function values(values: readonly (string | null)[]) {
  return new Set(values.flatMap((value) => value ? [value] : []));
}

/** Missing values are unknown, not conflicts. MOCK never supplies reliable operator evidence. */
export function materialConflicts(records: readonly GlobalConciliationRecord[]): MaterialConflictField[] {
  const conflicts: MaterialConflictField[] = [];
  if (values(records.map((record) => comparable(record.documento))).size > 1) conflicts.push("DOCUMENTO");
  if (values(records.map((record) => comparable(record.nombre))).size > 1) conflicts.push("IDENTIDAD");
  const operators = values(records.map((record) => record.provenance === "MOCK" || !record.operadorActual ? null : normalizeOperator(record.operadorActual)));
  if (operators.size > 1) conflicts.push("OPERADOR_ACTUAL");
  if (values(records.map((record) => record.fechaPortabilidad?.toISOString().slice(0, 10) ?? null)).size > 1) conflicts.push("FECHA_PORTABILIDAD");
  return conflicts;
}
