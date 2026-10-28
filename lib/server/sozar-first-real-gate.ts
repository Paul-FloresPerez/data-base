import "server-only";

import { getSozarMobileFingerprintKeyFromEnvironment } from "./sozar-control-plane.ts";
import { getSozarResponseEncryptionKeyFromEnvironment } from "./sozar-response-inspection.ts";

/**
 * A separate reviewed release gate for the one-off production probe. It must
 * opens only the reviewed, one-shot administrative route. Environment values
 * cannot open it, and it never enables the shared/bulk HLR provider.
 */
export const SOZAR_FIRST_REAL_TEST_CODE_GATE = true;

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
  // The provider has not documented a tariff. Cost is therefore explicitly
  // unknown for this one approved probe; the administrator's confirmation is
  // recorded, but no fabricated monetary limit is persisted.
  return {
    mobileFingerprintKey: getSozarMobileFingerprintKeyFromEnvironment(),
    encryptedResponseKey: getSozarResponseEncryptionKeyFromEnvironment(),
  };
}
