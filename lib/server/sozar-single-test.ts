import "server-only";

import { validateSpanishMobileForSozar } from "./sozar-hlr-provider.ts";
import { fingerprintHlrMobile, type HlrApprovalLimit, validateHlrApprovalLimit } from "./sozar-control-plane.ts";

export type ExistingSozarConsultationState = "PENDIENTE" | "EN_CURSO" | "EXITOSA" | "INCIERTA" | "FALLIDA";

export interface SingleSozarTestActor {
  /** Set only after the request handler has verified the authenticated admin session. */
  isAdministrator: boolean;
  userId: string;
}

export interface SingleSozarTestRequest {
  actor: SingleSozarTestActor;
  baseId: string;
  mobile: string;
  /** Deliberately verbose so a future administrative action cannot be accidental. */
  confirmation: "SOZAR_SINGLE_TEST";
  approval: HlrApprovalLimit;
  mobileFingerprintKey: string;
  existing: {
    hasReusableRealResult: boolean;
    consultationState: ExistingSozarConsultationState | null;
  };
}

export type SingleSozarTestPreflight =
  | { status: "LISTO_PARA_UNA_CONSULTA"; mobile: string; mobileFingerprint: string; idempotencyKey: string }
  | { status: "REUTILIZAR_RESULTADO_REAL"; mobileFingerprint: string }
  | { status: "BLOQUEADO_POR_CONSULTA_EXISTENTE"; mobileFingerprint: string; consultationState: ExistingSozarConsultationState };

export class SingleSozarTestPolicyError extends Error {}

/**
 * Server-side policy for the first supplier request. It performs no I/O: a
 * future authenticated route must obtain the existing state transactionally,
 * then persist its approval/job only when this preflight returns READY.
 */
export function prepareSingleSozarTest(request: SingleSozarTestRequest): SingleSozarTestPreflight {
  if (!request.actor.isAdministrator || !request.actor.userId.trim()) {
    throw new SingleSozarTestPolicyError("La prueba individual requiere una sesión administrativa válida.");
  }
  if (request.confirmation !== "SOZAR_SINGLE_TEST") {
    throw new SingleSozarTestPolicyError("Falta la confirmación explícita para la prueba individual de Sozar.");
  }
  if (!request.baseId.trim()) {
    throw new SingleSozarTestPolicyError("La prueba individual debe estar vinculada a una base.");
  }

  const approval = validateHlrApprovalLimit(request.approval);
  if (approval.maxQueries !== 1) {
    throw new SingleSozarTestPolicyError("La prueba controlada de Sozar admite exactamente una consulta.");
  }

  const mobile = validateSpanishMobileForSozar(request.mobile);
  const mobileFingerprint = fingerprintHlrMobile(mobile, request.mobileFingerprintKey);

  if (request.existing.hasReusableRealResult) {
    return { status: "REUTILIZAR_RESULTADO_REAL", mobileFingerprint };
  }
  if (request.existing.consultationState) {
    // A timeout is INCIERTA and is intentionally not retried automatically.
    return {
      status: "BLOQUEADO_POR_CONSULTA_EXISTENTE",
      mobileFingerprint,
      consultationState: request.existing.consultationState,
    };
  }

  return {
    status: "LISTO_PARA_UNA_CONSULTA",
    mobile,
    mobileFingerprint,
    idempotencyKey: `${request.baseId}:sozar:single:v1:${mobileFingerprint}`,
  };
}
