import "server-only";

import { getSozarMobileFingerprintKeyFromEnvironment } from "./sozar-control-plane.ts";
import { getSozarResponseEncryptionKeyFromEnvironment } from "./sozar-response-inspection.ts";

/**
 * A separate reviewed release gate for the one-off production probe. It opens
 * only the reviewed, one-shot administrative route. Environment values cannot
 * open it, and it never enables the shared/bulk HLR provider.
 */
export const SOZAR_FIRST_REAL_TEST_CODE_GATE = true;

export const SOZAR_FIRST_REAL_TEST_OPERATION_KEY = "sozar:first-real-test:v1";

export type FirstRealSozarAttemptPolicy = {
  maxAttempts: number;
  budgetMaxCents: number;
  maxCostPerAttemptCents: number;
};

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

function readNonNegativeInteger(name: string, fallback: number) {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} debe ser un entero no negativo.`);
  }
  return value;
}

/**
 * This policy cannot open either transport gate. Its safe default preserves
 * the historical single-attempt behavior. More than one billable attempt
 * requires explicit, positive budget and cost values in server-only config.
 */
export function getFirstRealSozarAttemptPolicy(): FirstRealSozarAttemptPolicy {
  const maxAttempts = readNonNegativeInteger("SOZAR_FIRST_REAL_MAX_ATTEMPTS", 1);
  const budgetMaxCents = readNonNegativeInteger("SOZAR_FIRST_REAL_BUDGET_CENTS", 0);
  const maxCostPerAttemptCents = readNonNegativeInteger("SOZAR_FIRST_REAL_MAX_COST_CENTS", 0);
  if (maxAttempts < 1 || maxAttempts > 100) {
    throw new Error("SOZAR_FIRST_REAL_MAX_ATTEMPTS debe estar entre 1 y 100.");
  }
  if (maxAttempts > 1 && (budgetMaxCents < 1 || maxCostPerAttemptCents < 1 || maxCostPerAttemptCents > budgetMaxCents)) {
    throw new Error("Más de una consulta requiere presupuesto y coste máximo positivos y coherentes.");
  }
  return { maxAttempts, budgetMaxCents, maxCostPerAttemptCents };
}
