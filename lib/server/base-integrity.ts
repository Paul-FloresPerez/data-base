import "server-only";

import { commercialEligibility } from "../campaigns/campaign-engine.ts";
import { isNullLikeName, normalizeSpanishMobile, spanishMobileExclusionReason } from "../excel/cleaning.ts";
import type { ColumnMapping, ExclusionReason } from "../excel/types.ts";
import type { SavedLot, StoredRecord, StoredTipification } from "../persistence/workspace-persistence.ts";

const tipificationByReason: Record<ExclusionReason, StoredTipification> = {
  telefono_vacio: "TELEFONO_VACIO",
  telefono_fijo: "TELEFONO_FIJO",
  telefono_invalido: "TELEFONO_INVALIDO",
  nombre_vacio: "NOMBRE_VACIO",
  telefono_duplicado: "TELEFONO_DUPLICADO",
};

export type DerivedRecordIntegrity = Pick<StoredRecord, "normalizedMobile" | "reason" | "tipification">;

function basicIntegrity(record: StoredRecord, mapping: ColumnMapping): DerivedRecordIntegrity {
  const phoneFailure = spanishMobileExclusionReason(record.mobile);
  if (phoneFailure) return { normalizedMobile: null, reason: phoneFailure, tipification: tipificationByReason[phoneFailure] };
  if (mapping.nombre !== undefined && isNullLikeName(record.name)) {
    return { normalizedMobile: null, reason: "nombre_vacio", tipification: "NOMBRE_VACIO" };
  }
  const normalizedMobile = normalizeSpanishMobile(record.mobile);
  if (!normalizedMobile) return { normalizedMobile: null, reason: "telefono_invalido", tipification: "TELEFONO_INVALIDO" };
  return { normalizedMobile, reason: null, tipification: "VALIDO" };
}

/**
 * Derives the operational mobile state exclusively from original CRM values.
 * The client-submitted normalized mobile, exclusion reason and tipification
 * are intentionally not used as a source of truth.
 */
export function deriveRecordsIntegrity(records: readonly StoredRecord[], mapping: ColumnMapping): Map<number, DerivedRecordIntegrity> {
  const result = new Map<number, DerivedRecordIntegrity>();
  const seenMobiles = new Set<string>();
  for (const record of records) {
    if (!Number.isInteger(record.sourceRow) || record.sourceRow < 2 || result.has(record.sourceRow)) {
      throw new Error("Las filas originales deben ser identificadores únicos y válidos.");
    }
    const derived = basicIntegrity(record, mapping);
    if (derived.normalizedMobile && seenMobiles.has(derived.normalizedMobile)) {
      result.set(record.sourceRow, { normalizedMobile: null, reason: "telefono_duplicado", tipification: "TELEFONO_DUPLICADO" });
      continue;
    }
    if (derived.normalizedMobile) seenMobiles.add(derived.normalizedMobile);
    result.set(record.sourceRow, derived);
  }
  return result;
}

/** Validates fields that cannot safely be deferred until all chunks arrive. */
export function assertIncomingRecordIntegrity(records: readonly StoredRecord[], mapping: ColumnMapping): void {
  const rows = new Set<number>();
  for (const record of records) {
    if (!Number.isInteger(record.sourceRow) || record.sourceRow < 2 || rows.has(record.sourceRow)) {
      throw new Error("El bloque contiene filas originales duplicadas o no válidas.");
    }
    rows.add(record.sourceRow);
    if (record.mobile !== (record.cells[mapping.movil] ?? "")) {
      throw new Error("El móvil debe provenir de la columna móvil original.");
    }
    if (mapping.documento !== undefined && record.document !== (record.cells[mapping.documento] ?? "")) {
      throw new Error("El documento no coincide con la columna original.");
    }
    if (mapping.nombre !== undefined && record.name !== (record.cells[mapping.nombre] ?? "")) {
      throw new Error("El nombre no coincide con la columna original.");
    }
    if (mapping.telefono_contacto !== undefined && record.contactPhone !== (record.cells[mapping.telefono_contacto] ?? "")) {
      throw new Error("El teléfono de contacto no coincide con la columna original.");
    }
    const derived = basicIntegrity(record, mapping);
    // A normalized value can only be supplied for a genuinely valid mobile.
    // Null remains acceptable here because a later chunk can reveal a duplicate.
    if (record.normalizedMobile !== null && record.normalizedMobile !== derived.normalizedMobile) {
      throw new Error("El móvil normalizado no coincide con la columna original.");
    }
  }
}

export function assertCompletedRecordIntegrity(
  records: readonly StoredRecord[],
  mapping: ColumnMapping,
  state: "LISTA_PARA_LIMPIAR" | "LISTA_PARA_ENRIQUECER" | "LISTA_PARA_DISTRIBUIR",
): Map<number, DerivedRecordIntegrity> {
  const derived = deriveRecordsIntegrity(records, mapping);
  if (state === "LISTA_PARA_LIMPIAR") return derived;
  for (const record of records) {
    const expected = derived.get(record.sourceRow)!;
    if (record.normalizedMobile !== expected.normalizedMobile || record.reason !== expected.reason || record.tipification !== expected.tipification) {
      throw new Error("Los resultados de limpieza no coinciden con los datos originales.");
    }
  }
  return derived;
}

export function assertLotsIntegrity(lots: readonly SavedLot[], derived: ReadonlyMap<number, DerivedRecordIntegrity>): void {
  const lotKeys = new Set<string>();
  const campaignRows = new Map<string, Set<number>>();
  for (const lot of lots) {
    if (!Number.isInteger(lot.number) || lot.number < 1 || lot.sourceRows.length < 1 || lot.sourceRows.length > 100) {
      throw new Error("Cada lote debe contener entre 1 y 100 registros.");
    }
    const lotKey = `${lot.campaign}:${lot.number}`;
    if (lotKeys.has(lotKey)) throw new Error("No se permiten números de lote repetidos dentro de una campaña.");
    lotKeys.add(lotKey);
    const rows = campaignRows.get(lot.campaign) ?? new Set<number>();
    for (const sourceRow of lot.sourceRows) {
      const record = derived.get(sourceRow);
      if (!record) throw new Error("Un lote contiene registros ajenos a la base.");
      if (record.tipification !== "VALIDO") throw new Error("Un lote no puede incluir móviles inválidos, excluidos o duplicados.");
      if (rows.has(sourceRow)) throw new Error("Un registro no puede repetirse dentro de una misma campaña.");
      rows.add(sourceRow);
    }
    campaignRows.set(lot.campaign, rows);
  }
}

/**
 * Re-derives campaign eligibility from data persisted by the server. Client
 * lots are only row references and cannot assert an operator or provenance.
 */
export function assertCommercialLotsIntegrity(
  lots: readonly SavedLot[],
  rows: readonly { sourceRow: number; operadorActual: string | null; provenance: string }[],
): void {
  const rowsBySource = new Map(rows.map((row) => [row.sourceRow, row]));
  for (const lot of lots) {
    const campaign = lot.campaign.toLocaleLowerCase("es-ES") as "yoigo" | "vodafone";
    for (const sourceRow of lot.sourceRows) {
      const row = rowsBySource.get(sourceRow);
      if (!row) throw new Error("Un lote contiene registros sin datos comerciales persistidos.");
      const eligibility = commercialEligibility(campaign, row.operadorActual ?? "", row.provenance);
      if (eligibility !== "ELEGIBLE") {
        throw new Error("Un lote contiene un móvil no elegible según la matriz comercial vigente.");
      }
    }
  }
}
