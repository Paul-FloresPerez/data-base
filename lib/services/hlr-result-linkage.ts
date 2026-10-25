import type { ValidRecord } from "../excel/types.ts";
import { normalizeSpanishMobile } from "../excel/cleaning.ts";
import type { HlrEnrichmentResult } from "./hlr-contract.ts";

/**
 * A future provider response is matched only through its returned mobile. Row
 * indices are deliberately absent, so reordering an Excel cannot misapply an
 * enrichment result.
 */
export function indexHlrResultsByNormalizedMobile(results: readonly HlrEnrichmentResult[]) {
  const byMobile = new Map<string, HlrEnrichmentResult>();
  for (const result of results) {
    const normalizedMobile = normalizeSpanishMobile(result.mobile);
    if (normalizedMobile && !byMobile.has(normalizedMobile)) byMobile.set(normalizedMobile, result);
  }
  return byMobile;
}

export function linkHlrResultToRecord(
  record: ValidRecord,
  resultsByMobile: ReadonlyMap<string, HlrEnrichmentResult>,
) {
  return resultsByMobile.get(record.normalizedMobile) ?? null;
}
