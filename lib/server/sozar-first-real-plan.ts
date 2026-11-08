import "server-only";

import { fingerprintHlrMobile } from "./sozar-control-plane.ts";
import { validateSpanishMobileForSozar } from "./sozar-hlr-provider.ts";
import { SOZAR_FIRST_REAL_TEST_OPERATION_KEY } from "./sozar-first-real-gate.ts";

export type FirstRealTestExistingState = "PENDIENTE" | "EN_CURSO" | "EXITOSA" | "INCIERTA" | "FALLIDA" | null;

export type FirstRealTestPlan =
  | { status: "LISTO"; mobile: string; mobileFingerprint: string; operationKey: string; idempotencyKey: string }
  | { status: "BLOQUEADO"; reason: "LIMITE_GLOBAL" | "RESULTADO_REUTILIZABLE" | "COLA_EXISTENTE" };

/** Pure policy used by the transactional repository and network-free tests. */
export function planFirstRealSozarTest(input: {
  baseId: string;
  mobile: string;
  mobileFingerprintKey: string;
  attemptLimitReached: boolean;
  hasReusableRealResult: boolean;
  existingConsultationState: FirstRealTestExistingState;
}): FirstRealTestPlan {
  if (input.hasReusableRealResult) return { status: "BLOQUEADO", reason: "RESULTADO_REUTILIZABLE" };
  if (input.existingConsultationState) return { status: "BLOQUEADO", reason: "COLA_EXISTENTE" };
  if (input.attemptLimitReached) return { status: "BLOQUEADO", reason: "LIMITE_GLOBAL" };
  const mobile = validateSpanishMobileForSozar(input.mobile);
  const mobileFingerprint = fingerprintHlrMobile(mobile, input.mobileFingerprintKey);
  return {
    status: "LISTO",
    mobile,
    mobileFingerprint,
    operationKey: SOZAR_FIRST_REAL_TEST_OPERATION_KEY,
    idempotencyKey: `${input.baseId}:sozar:first-real:v1:${mobileFingerprint}`,
  };
}
