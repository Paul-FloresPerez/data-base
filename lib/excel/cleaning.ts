import type {
  ColumnMapping,
  CleaningResult,
  ExcludedRecord,
  ExclusionReason,
  ImportedDataset,
  ReasonBreakdown,
  ValidRecord,
} from "./types";

const emptyBreakdown = (): ReasonBreakdown => ({
  telefono_vacio: 0,
  telefono_fijo: 0,
  telefono_invalido: 0,
  nombre_vacio: 0,
  telefono_duplicado: 0,
  documento_ausente: 0,
  documento_dni_invalido: 0,
  documento_nie_invalido: 0,
  documento_no_verificable: 0,
  nombre_incompleto: 0,
  nombre_invalido: 0,
  apellidos_incompletos: 0,
  apellidos_invalidos: 0,
});

const nullNameValues = new Set(["", "null", "n/a", "na", "-", "0", "sin nombre", "desconocido", "unknown"]);
const dniLetters = "TRWAGMYFPDXBNJZSQVHLCKE";

export function isNullLikeName(value: string): boolean {
  const normalized = value.trim().toLocaleLowerCase("es-ES");
  return normalized.length === 0 || nullNameValues.has(normalized);
}

function normalizedDocument(value: string) {
  return value.trim().toLocaleUpperCase("es-ES").replace(/[\s-]/g, "");
}

export function documentIdentityReason(value: string): ExclusionReason | null {
  const document = normalizedDocument(value);
  if (!document || nullNameValues.has(document.toLocaleLowerCase("es-ES"))) return "documento_ausente";
  const dni = /^(\d{8})([A-Z])$/.exec(document);
  if (dni) return dniLetters[Number(dni[1]) % 23] === dni[2] ? null : "documento_dni_invalido";
  const nie = /^([XYZ])(\d{7})([A-Z])$/.exec(document);
  if (nie) {
    const prefix = { X: "0", Y: "1", Z: "2" }[nie[1]!];
    return dniLetters[Number(`${prefix}${nie[2]}`) % 23] === nie[3] ? null : "documento_nie_invalido";
  }
  return "documento_no_verificable";
}

function isLegiblePersonName(value: string): boolean {
  const compact = value.trim().replace(/\s+/g, " ");
  return !isNullLikeName(compact)
    && /\p{L}/u.test(compact)
    && /^[\p{L}\p{M}][\p{L}\p{M}'’ .·-]*$/u.test(compact);
}

/** Applies the identity fields required before a provider-bound enrichment. */
export function identityExclusionReason(record: { document: string; name: string; cells: string[] }, mapping: ColumnMapping): ExclusionReason | null {
  const document = mapping.documento === undefined ? "" : record.document;
  const documentReason = documentIdentityReason(document);
  if (documentReason) return documentReason;
  if (mapping.nombre === undefined) return "nombre_incompleto";
  if (isNullLikeName(record.name)) return "nombre_incompleto";
  if (!isLegiblePersonName(record.name)) return "nombre_invalido";
  const surnames = [mapping.apellido_paterno, mapping.apellido_materno]
    .filter((index): index is number => index !== undefined)
    .map((index) => record.cells[index] ?? "");
  if (surnames.some(isNullLikeName)) return "apellidos_incompletos";
  if (surnames.some((value) => !isLegiblePersonName(value))) return "apellidos_invalidos";
  return null;
}

export function normalizeSpanishMobile(value: string): string | null {
  let compact = value.trim().replace(/[\s-]/g, "");

  if (compact.startsWith("+34")) {
    compact = compact.slice(3);
  } else if (compact.startsWith("0034")) {
    compact = compact.slice(4);
  }

  return /^[67]\d{8}$/.test(compact) ? compact : null;
}

export function spanishMobileExclusionReason(value: string): ExclusionReason | null {
  const compact = value.trim().replace(/[\s-]/g, "").replace(/^(\+34|0034)/, "");

  if (compact.length === 0) {
    return "telefono_vacio";
  }

  if (/^[89]\d{8}$/.test(compact)) {
    return "telefono_fijo";
  }

  return normalizeSpanishMobile(value) === null ? "telefono_invalido" : null;
}

export function cleanDataset(dataset: ImportedDataset): CleaningResult {
  const seenPhones = new Set<string>();
  const validRecords: ValidRecord[] = [];
  const excludedRecords: ExcludedRecord[] = [];
  const reasonBreakdown = emptyBreakdown();

  for (const record of dataset.records) {
    const invalidPhoneReason = spanishMobileExclusionReason(record.mobile);

    if (invalidPhoneReason) {
      excludedRecords.push({ ...record, reason: invalidPhoneReason });
      reasonBreakdown[invalidPhoneReason] += 1;
      continue;
    }

    // Importing a source remains permissive for non-identity fields. The
    // stricter DNI/NIE policy is enforced at the Sozar boundary below.
    if (dataset.columnMapping.nombre !== undefined && isNullLikeName(record.name)) {
      excludedRecords.push({ ...record, reason: "nombre_vacio" });
      reasonBreakdown.nombre_vacio += 1;
      continue;
    }

    const normalizedMobile = normalizeSpanishMobile(record.mobile);

    if (!normalizedMobile) {
      excludedRecords.push({ ...record, reason: "telefono_invalido" });
      reasonBreakdown.telefono_invalido += 1;
      continue;
    }

    if (seenPhones.has(normalizedMobile)) {
      excludedRecords.push({ ...record, reason: "telefono_duplicado" });
      reasonBreakdown.telefono_duplicado += 1;
      continue;
    }

    seenPhones.add(normalizedMobile);
    validRecords.push({ ...record, normalizedMobile });
  }

  return { validRecords, excludedRecords, reasonBreakdown };
}
