import "server-only";

import { createHmac } from "node:crypto";
import { validateSpanishMobileForSozar } from "./sozar-hlr-provider.ts";

const PROVIDER = "sozar";
const BASE64URL_256_BIT_SECRET = /^[A-Za-z0-9_-]{43}$/;

export type HlrApprovalLimit = {
  maxQueries: number;
  budgetMaxCents: number;
  maxCostPerQueryCents: number;
};

export class HlrApprovalLimitError extends Error {}

const DEFAULT_REAL_HLR_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MIN_REAL_HLR_CACHE_TTL_MS = 60 * 60 * 1000;
const MAX_REAL_HLR_CACHE_TTL_MS = 365 * 24 * 60 * 60 * 1000;

/** Server-only policy value; simulated results never enter this cache. */
export function getRealHlrCacheTtlMs(value = process.env.SOZAR_REAL_CACHE_TTL_HOURS): number {
  if (value === undefined || value.trim() === "") return DEFAULT_REAL_HLR_CACHE_TTL_MS;
  const hours = Number(value);
  const ttl = hours * 60 * 60 * 1000;
  if (!Number.isInteger(hours) || ttl < MIN_REAL_HLR_CACHE_TTL_MS || ttl > MAX_REAL_HLR_CACHE_TTL_MS) {
    throw new HlrApprovalLimitError("La vigencia de caché real HLR debe estar entre 1 y 8.760 horas.");
  }
  return ttl;
}

export function getRealHlrCacheExpiry(now: Date, ttlMs = getRealHlrCacheTtlMs()) {
  return new Date(now.getTime() + ttlMs);
}

/**
 * A deterministic HMAC permits global deduplication without storing the
 * telephone number in the real-provider control tables. The key must remain a
 * server secret and must never be derived from a public application secret.
 */
export function fingerprintHlrMobile(mobile: string, hmacKey: string): string {
  const normalizedMobile = validateSpanishMobileForSozar(mobile);
  if (!hmacKey.trim()) throw new HlrApprovalLimitError("Falta la clave privada de huella HLR.");
  return createHmac("sha256", hmacKey).update(`${PROVIDER}:${normalizedMobile}`).digest("base64url");
}

/**
 * The fingerprint key is deliberately a 256-bit, unpadded base64url secret.
 * This makes its operational format as strict as the AES response key while
 * keeping the value server-only.
 */
export function getSozarMobileFingerprintKeyFromEnvironment(): string {
  const encodedKey = process.env.SOZAR_MOBILE_FINGERPRINT_KEY;
  if (!encodedKey?.trim() || !BASE64URL_256_BIT_SECRET.test(encodedKey)) {
    throw new HlrApprovalLimitError("La clave privada de huella Sozar debe ser un secreto base64url de 32 bytes.");
  }
  if (Buffer.from(encodedKey, "base64url").length !== 32) {
    throw new HlrApprovalLimitError("La clave privada de huella Sozar debe descodificar a 32 bytes.");
  }
  return encodedKey;
}

/** Rejects any approval which could be understood as a free or unbounded run. */
export function validateHlrApprovalLimit(limit: HlrApprovalLimit): HlrApprovalLimit {
  if (!Number.isInteger(limit.maxQueries) || limit.maxQueries < 1) {
    throw new HlrApprovalLimitError("La aprobación HLR necesita un límite positivo de consultas.");
  }
  if (!Number.isInteger(limit.budgetMaxCents) || limit.budgetMaxCents < 1) {
    throw new HlrApprovalLimitError("La aprobación HLR necesita un presupuesto positivo en céntimos.");
  }
  if (!Number.isInteger(limit.maxCostPerQueryCents) || limit.maxCostPerQueryCents < 1) {
    throw new HlrApprovalLimitError("Falta el coste máximo confirmado por consulta HLR.");
  }
  if (limit.maxCostPerQueryCents > limit.budgetMaxCents) {
    throw new HlrApprovalLimitError("El coste máximo por consulta supera el presupuesto aprobado.");
  }
  return limit;
}
