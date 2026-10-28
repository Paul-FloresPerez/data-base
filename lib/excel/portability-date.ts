export interface PortabilityDateParts {
  anio: string;
  mes: string;
  dia: string;
}

const emptyDateParts: PortabilityDateParts = { anio: "", mes: "", dia: "" };

function isCalendarDate(year: number, month: number, day: number): boolean {
  const candidate = new Date(Date.UTC(year, month - 1, day));
  return candidate.getUTCFullYear() === year && candidate.getUTCMonth() === month - 1 && candidate.getUTCDate() === day;
}

/**
 * Extracts the calendar date without converting time zones. Historical Excel
 * exports can contain a UTC timestamp; its YYYY-MM-DD portion is preserved as
 * the source calendar date and the original string remains unchanged.
 */
export function parsePortabilityDateParts(value: string | null | undefined): PortabilityDateParts | null {
  const dateValue = value?.trim();
  if (!dateValue) return null;

  const isoMatch = dateValue.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)?$/);
  const localMatch = dateValue.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  const values = isoMatch
    ? [Number(isoMatch[1]), Number(isoMatch[2]), Number(isoMatch[3])]
    : localMatch
      ? [Number(localMatch[3]), Number(localMatch[2]), Number(localMatch[1])]
      : null;
  if (!values || !isCalendarDate(values[0], values[1], values[2])) return null;
  return { anio: String(values[0]), mes: String(values[1]).padStart(2, "0"), dia: String(values[2]).padStart(2, "0") };
}

export function datePartsFromPortability(value: string | null | undefined): PortabilityDateParts {
  return parsePortabilityDateParts(value) ?? emptyDateParts;
}

export function portabilityDateForStorage(value: string | null | undefined): string | null {
  const parts = parsePortabilityDateParts(value);
  return parts ? `${parts.anio}-${parts.mes}-${parts.dia}` : null;
}
