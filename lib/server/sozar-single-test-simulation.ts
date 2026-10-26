import "server-only";

import type { DocumentedSozarResponseContract, DocumentedSozarMappingResult } from "../services/sozar-response-contract.ts";
import { mapWithDocumentedSozarContract } from "../services/sozar-response-contract.ts";
import { describeSozarResponseShape, encryptSozarResponseForInspection, type EncryptedSozarResponse, type SozarResponseShape } from "./sozar-response-inspection.ts";
import type { SingleSozarTestPreflight } from "./sozar-single-test.ts";

export type SimulatedSozarTransport = (mobile: string) => Promise<unknown>;

export type SimulatedSingleSozarTestResult =
  | { status: "RESPUESTA_RECIBIDA"; retryAutomatically: false; encryptedResponse: EncryptedSozarResponse; inspection: SozarResponseShape; mapping: DocumentedSozarMappingResult }
  | { status: "INCIERTA"; retryAutomatically: false }
  | { status: "FALLIDA"; retryAutomatically: false };

/**
 * Test-only end-to-end seam. It accepts an injected in-process transport and
 * deliberately does not import or create the HTTP transport used by Sozar.
 */
export async function simulateSingleSozarTest(
  preflight: Extract<SingleSozarTestPreflight, { status: "LISTO_PARA_UNA_CONSULTA" }>,
  transport: SimulatedSozarTransport,
  encryptedResponseKey: string,
  contract: DocumentedSozarResponseContract | null,
  consultedAt = new Date().toISOString(),
): Promise<SimulatedSingleSozarTestResult> {
  try {
    const response = await transport(preflight.mobile);
    const encryptedResponse = encryptSozarResponseForInspection(response, encryptedResponseKey, consultedAt);
    return {
      status: "RESPUESTA_RECIBIDA",
      retryAutomatically: false,
      encryptedResponse,
      inspection: describeSozarResponseShape(response),
      mapping: mapWithDocumentedSozarContract(preflight.mobile, response, contract, consultedAt),
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") return { status: "INCIERTA", retryAutomatically: false };
    return { status: "FALLIDA", retryAutomatically: false };
  }
}
