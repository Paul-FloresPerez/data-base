import "server-only";

import { prisma } from "./prisma.ts";
import { fingerprintHlrMobile } from "./sozar-control-plane.ts";
import { prepareSingleSozarTest, type SingleSozarTestActor, type SingleSozarTestPreflight } from "./sozar-single-test.ts";
import type { HlrApprovalLimit } from "./sozar-control-plane.ts";

const PROVIDER = "sozar";

export class SozarSingleTestRepositoryError extends Error {}

function getMobileFingerprintKey() {
  const key = process.env.SOZAR_MOBILE_FINGERPRINT_KEY;
  if (!key?.trim()) throw new SozarSingleTestRepositoryError("Falta la clave privada de huella Sozar.");
  return key;
}

/**
 * Read-only server preflight for a future administrative endpoint. It checks
 * the persistent real-result cache and every prior queue state before a job
 * could be created. It does not create approvals, jobs or network traffic.
 */
export async function preflightSingleSozarTest(input: {
  actor: SingleSozarTestActor;
  baseId: string;
  mobile: string;
  confirmation: "SOZAR_SINGLE_TEST";
  approval: HlrApprovalLimit;
  now?: Date;
}): Promise<SingleSozarTestPreflight> {
  const key = getMobileFingerprintKey();
  const mobileFingerprint = fingerprintHlrMobile(input.mobile, key);
  const now = input.now ?? new Date();
  const [base, cachedResult, consultation] = await Promise.all([
    prisma.base.findUnique({ where: { id: input.baseId }, select: { id: true } }),
    prisma.resultadoHlrReal.findFirst({
      where: { proveedor: PROVIDER, huellaMovil: mobileFingerprint, vigenteHasta: { gt: now } },
      select: { id: true },
    }),
    prisma.consultaHlr.findUnique({
      where: { proveedor_huellaMovil: { proveedor: PROVIDER, huellaMovil: mobileFingerprint } },
      select: { estado: true },
    }),
  ]);
  if (!base) throw new SozarSingleTestRepositoryError("La base indicada no existe o no está disponible.");

  return prepareSingleSozarTest({
    ...input,
    mobileFingerprintKey: key,
    existing: {
      hasReusableRealResult: Boolean(cachedResult),
      consultationState: consultation?.estado ?? null,
    },
  });
}
