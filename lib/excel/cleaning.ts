import type {
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
});

const nullNameValues = new Set(["null", "n/a"]);

export function isNullLikeName(value: string): boolean {
  const normalized = value.trim().toLocaleLowerCase("es-ES");
  return normalized.length === 0 || nullNameValues.has(normalized);
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

function phoneReason(value: string): ExclusionReason | null {
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
    const invalidPhoneReason = phoneReason(record.mobile);

    if (invalidPhoneReason) {
      excludedRecords.push({ ...record, reason: invalidPhoneReason });
      reasonBreakdown[invalidPhoneReason] += 1;
      continue;
    }

    if (isNullLikeName(record.name)) {
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
