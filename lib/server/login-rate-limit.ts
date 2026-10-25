import "server-only";

import { createHmac } from "node:crypto";
import { Prisma } from "../../generated/prisma/client.ts";
import { getAuthSecret } from "../auth/auth-secret.ts";
import {
  createLoginRateLimiter,
  type LoginRateLimitPolicy,
  type SharedLoginRateLimitStore,
} from "./login-rate-limit-core.ts";

const policy: LoginRateLimitPolicy = {
  maxAttempts: 5,
  windowMs: 15 * 60 * 1000,
};

function loginAttemptFingerprint(username: string) {
  const secret = getAuthSecret();
  if (!secret) throw new Error("No hay secreto de sesión para proteger los intentos de acceso.");
  return createHmac("sha256", secret)
    .update(`login-rate-limit:v1:${username.trim().toLowerCase()}`)
    .digest("base64url");
}

async function getSharedStore(): Promise<SharedLoginRateLimitStore> {
  const { prisma } = await import("./prisma.ts");

  return {
    async isAllowed(key, now) {
      const rows = await prisma.$queryRaw<Array<{ bloqueado_hasta: Date | null }>>(Prisma.sql`
        SELECT "bloqueado_hasta"
        FROM "limites_intentos_login"
        WHERE "clave" = ${key}
        LIMIT 1
      `);
      return !rows[0]?.bloqueado_hasta || rows[0].bloqueado_hasta <= now;
    },
    async recordFailure(key, configuredPolicy, now) {
      await prisma.$executeRaw(Prisma.sql`
        INSERT INTO "limites_intentos_login" (
          "clave", "intentos", "ventana_iniciada_en", "bloqueado_hasta", "actualizado_en"
        ) VALUES (${key}, 1, ${now}, NULL, ${now})
        ON CONFLICT ("clave") DO UPDATE
        SET
          "intentos" = CASE
            WHEN "limites_intentos_login"."bloqueado_hasta" > ${now} THEN "limites_intentos_login"."intentos"
            WHEN "limites_intentos_login"."ventana_iniciada_en" <= ${now} - (${configuredPolicy.windowMs} * INTERVAL '1 millisecond') THEN 1
            ELSE "limites_intentos_login"."intentos" + 1
          END,
          "ventana_iniciada_en" = CASE
            WHEN "limites_intentos_login"."bloqueado_hasta" > ${now} THEN "limites_intentos_login"."ventana_iniciada_en"
            WHEN "limites_intentos_login"."ventana_iniciada_en" <= ${now} - (${configuredPolicy.windowMs} * INTERVAL '1 millisecond') THEN ${now}
            ELSE "limites_intentos_login"."ventana_iniciada_en"
          END,
          "bloqueado_hasta" = CASE
            WHEN "limites_intentos_login"."bloqueado_hasta" > ${now} THEN "limites_intentos_login"."bloqueado_hasta"
            WHEN "limites_intentos_login"."ventana_iniciada_en" <= ${now} - (${configuredPolicy.windowMs} * INTERVAL '1 millisecond') THEN NULL
            WHEN "limites_intentos_login"."intentos" + 1 >= ${configuredPolicy.maxAttempts} THEN ${now} + (${configuredPolicy.windowMs} * INTERVAL '1 millisecond')
            ELSE NULL
          END,
          "actualizado_en" = ${now}
      `);
    },
    async clear(key) {
      await prisma.$executeRaw(Prisma.sql`DELETE FROM "limites_intentos_login" WHERE "clave" = ${key}`);
    },
  };
}

async function limiter() {
  return createLoginRateLimiter(await getSharedStore(), policy);
}

/**
 * Fail closed if the shared store is not available. A missing migration must
 * never silently revert a multi-instance deployment to process-local limits.
 */
export async function isLoginAllowed(username: string) {
  try {
    return await (await limiter()).isAllowed(loginAttemptFingerprint(username));
  } catch {
    return false;
  }
}

export async function recordFailedLogin(username: string) {
  try {
    await (await limiter()).recordFailedLogin(loginAttemptFingerprint(username));
  } catch {
    // The next check fails closed; do not leak infrastructure details to login.
  }
}

export async function clearLoginAttempts(username: string) {
  try {
    await (await limiter()).clearLoginAttempts(loginAttemptFingerprint(username));
  } catch {
    // A successful credential check must not expose a storage error to callers.
  }
}
