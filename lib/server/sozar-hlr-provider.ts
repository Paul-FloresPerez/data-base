import "server-only";

import { normalizeSpanishMobile } from "../excel/cleaning.ts";
import type { HlrEnrichmentResult, HlrProvider } from "../services/hlr-contract.ts";
import {
  mapWithDocumentedSozarContract,
  type DocumentedSozarMappingResult,
  type DocumentedSozarResponseContract,
} from "../services/sozar-response-contract.ts";

export const SOZAR_HLR_ENDPOINT_TEMPLATE = "https://apisozarusac.com/BackendJava/api/numbers/{numero}";

/** The real provider is deliberately hard-disabled in this preparation phase. */
export const isSozarHlrExecutionEnabled = false;

export class RealHlrProviderDisabledError extends Error {
  constructor() {
    super("El proveedor HLR real está deshabilitado durante la fase de preparación.");
  }
}

export class InvalidSpanishMobileForHlrError extends Error {
  constructor() {
    super("Sozar solo admite móviles españoles normalizados de nueve dígitos que comiencen por 6 o 7.");
  }
}

/** Server-side guard: required again immediately before any future paid call. */
export function validateSpanishMobileForSozar(mobile: string): string {
  const normalizedMobile = normalizeSpanishMobile(mobile);
  if (!normalizedMobile) throw new InvalidSpanishMobileForHlrError();
  return normalizedMobile;
}

/**
 * No supplier JSON schema was provided. This type remains empty on purpose: a
 * mapper can only be added from vendor documentation, never from guesswork.
 */
export type DocumentedSozarResponseMapping = DocumentedSozarResponseContract;
export type SozarMappingResult = DocumentedSozarMappingResult;

/**
 * Accepts a response only after field paths have been documented and reviewed.
 * It currently never infers property names or fabricates values.
 */
export function mapDocumentedSozarResponse(
  mobile: string,
  response: unknown,
  mapping: DocumentedSozarResponseMapping | null = null,
): SozarMappingResult {
  return mapWithDocumentedSozarContract(mobile, response, mapping, new Date().toISOString());
}

export class SozarHlrProvider implements HlrProvider {
  readonly id = "sozar";
  readonly mode = "real" as const;

  async lookup(mobile: string): Promise<HlrEnrichmentResult> {
    // Validation stays directly before future transport code. There is no fetch
    // in this module during preparation, so local tests cannot incur charges.
    const normalizedMobile = validateSpanishMobileForSozar(mobile);
    void normalizedMobile;
    if (!isSozarHlrExecutionEnabled) throw new RealHlrProviderDisabledError();
    throw new RealHlrProviderDisabledError();
  }
}
