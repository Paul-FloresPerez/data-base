import "server-only";

/**
 * A separate reviewed release gate for the one-off production probe. It must
 * remain false in every normal deployment. Environment variables cannot turn
 * it on; a reviewed source change and separate deployment are required.
 */
export const SOZAR_FIRST_REAL_TEST_CODE_GATE = false;

export const SOZAR_FIRST_REAL_TEST_OPERATION_KEY = "sozar:first-real-test:v1";

export class SozarFirstRealTestBlockedError extends Error {
  constructor() {
    super("La prueba real única de Sozar sigue bloqueada por código.");
  }
}

export function assertFirstRealSozarTestEnabled() {
  if (!SOZAR_FIRST_REAL_TEST_CODE_GATE) throw new SozarFirstRealTestBlockedError();
}

export function getFirstRealSozarTestConfiguration() {
  const mobileFingerprintKey = process.env.SOZAR_MOBILE_FINGERPRINT_KEY;
  const encryptedResponseKey = process.env.SOZAR_RESPONSE_ENCRYPTION_KEY;
  const maxCostCents = Number(process.env.SOZAR_FIRST_TEST_MAX_COST_CENTS ?? "");
  if (!mobileFingerprintKey?.trim() || !encryptedResponseKey?.trim()) {
    throw new Error("Faltan claves privadas de Sozar para la prueba real única.");
  }
  if (!Number.isSafeInteger(maxCostCents) || maxCostCents < 1) {
    throw new Error("Falta un coste máximo confirmado para la prueba real única de Sozar.");
  }
  return { mobileFingerprintKey, encryptedResponseKey, maxCostCents };
}
