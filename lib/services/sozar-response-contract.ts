import { normalizeSpanishMobile } from "../excel/cleaning.ts";
import type { HlrEnrichmentResult } from "./hlr-contract.ts";

export type SozarJsonPath = readonly string[];

/**
 * This is a reviewed description of a supplier response, never a guessed JSON
 * shape. A path is present only once it has been corroborated from anonymized
 * supplier documentation or a representative response.
 */
export interface DocumentedSozarResponseContract {
  version: string;
  /** Optional because an endpoint scoped by mobile may not echo the number. */
  returnedMobilePath?: SozarJsonPath;
  currentOperatorPath?: SozarJsonPath;
  originalOperatorPath?: SozarJsonPath;
  donorOperatorPath?: SozarJsonPath;
  portabilityDatePath?: SozarJsonPath;
}

export class SozarResponseContractError extends Error {}

export type DocumentedSozarMappingResult =
  | { status: "documentation_required" }
  | { status: "invalid_response"; reason: "mobile_mismatch" | "invalid_mobile" | "invalid_value" | "invalid_shape" }
  | { status: "mapped"; result: HlrEnrichmentResult };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertPath(path: SozarJsonPath, label: string) {
  if (path.length === 0 || path.length > 12 || path.some((part) => !/^[A-Za-z][A-Za-z0-9_]*$/.test(part))) {
    throw new SozarResponseContractError(`${label} debe usar una ruta JSON de claves documentadas.`);
  }
}

function readPath(response: unknown, path: SozarJsonPath): unknown {
  let current: unknown = response;
  for (const part of path) {
    if (!isRecord(current) || !Object.hasOwn(current, part)) return undefined;
    current = current[part];
  }
  return current;
}

function readOptionalString(response: unknown, path: SozarJsonPath | undefined) {
  if (!path) return { value: null, invalid: false } as const;
  const value = readPath(response, path);
  if (value === undefined || value === null) return { value: null, invalid: false } as const;
  if (typeof value !== "string") return { value: null, invalid: true } as const;
  return { value: value.trim() || null, invalid: false } as const;
}

/** Validates a contract without binding this application to vendor field names. */
export function validateDocumentedSozarResponseContract(contract: DocumentedSozarResponseContract) {
  if (!contract.version.trim() || contract.version.length > 120) {
    throw new SozarResponseContractError("El contrato Sozar necesita una versión documentada.");
  }
  const paths = [
    [contract.returnedMobilePath, "returnedMobilePath"],
    [contract.currentOperatorPath, "currentOperatorPath"],
    [contract.originalOperatorPath, "originalOperatorPath"],
    [contract.donorOperatorPath, "donorOperatorPath"],
    [contract.portabilityDatePath, "portabilityDatePath"],
  ] as const;
  for (const [path, label] of paths) if (path) assertPath(path, label);
  if (!contract.currentOperatorPath && !contract.originalOperatorPath && !contract.donorOperatorPath && !contract.portabilityDatePath) {
    throw new SozarResponseContractError("El contrato Sozar debe documentar al menos un campo de enriquecimiento.");
  }
  return contract;
}

/**
 * Maps only paths explicitly supplied by a reviewed contract. Missing provider
 * values remain null; the caller decides how a workbook renders those blanks.
 */
export function mapWithDocumentedSozarContract(
  requestedMobile: string,
  response: unknown,
  contract: DocumentedSozarResponseContract | null,
  consultedAt: string,
): DocumentedSozarMappingResult {
  if (!contract) return { status: "documentation_required" };
  validateDocumentedSozarResponseContract(contract);
  if (!isRecord(response)) return { status: "invalid_response", reason: "invalid_shape" };

  const normalizedRequestedMobile = normalizeSpanishMobile(requestedMobile);
  if (!normalizedRequestedMobile) return { status: "invalid_response", reason: "invalid_mobile" };

  const returnedMobile = readOptionalString(response, contract.returnedMobilePath);
  const fields = [
    readOptionalString(response, contract.currentOperatorPath),
    readOptionalString(response, contract.originalOperatorPath),
    readOptionalString(response, contract.donorOperatorPath),
    readOptionalString(response, contract.portabilityDatePath),
  ];
  if (returnedMobile.invalid || fields.some((field) => field.invalid)) return { status: "invalid_response", reason: "invalid_value" };
  if (returnedMobile.value) {
    const normalizedReturnedMobile = normalizeSpanishMobile(returnedMobile.value);
    if (!normalizedReturnedMobile) return { status: "invalid_response", reason: "invalid_mobile" };
    if (normalizedReturnedMobile !== normalizedRequestedMobile) return { status: "invalid_response", reason: "mobile_mismatch" };
  }

  return {
    status: "mapped",
    result: {
      mobile: normalizedRequestedMobile,
      operadorActual: fields[0].value,
      operadorOriginal: fields[1].value,
      operadorDonante: fields[2].value,
      fechaPortabilidad: fields[3].value,
      consultedAt,
      source: "API_REAL",
    },
  };
}
