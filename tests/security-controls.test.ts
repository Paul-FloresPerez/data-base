import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createLoginRateLimiter, type SharedLoginRateLimitStore } from "../lib/server/login-rate-limit-core.ts";
import { HlrApprovalLimitError, getRealHlrCacheExpiry, getRealHlrCacheTtlMs } from "../lib/server/sozar-control-plane.ts";

type Attempt = { failures: number; blockedUntil: Date | null; windowStartedAt: Date };

function createSharedTestStore(): SharedLoginRateLimitStore {
  const attempts = new Map<string, Attempt>();
  return {
    async isAllowed(key, now) {
      const attempt = attempts.get(key);
      return !attempt?.blockedUntil || attempt.blockedUntil <= now;
    },
    async recordFailure(key, policy, now) {
      const current = attempts.get(key);
      const freshWindow = !current || current.windowStartedAt.getTime() <= now.getTime() - policy.windowMs;
      const failures = freshWindow ? 1 : current.failures + 1;
      attempts.set(key, {
        failures,
        windowStartedAt: freshWindow ? now : current.windowStartedAt,
        blockedUntil: failures >= policy.maxAttempts ? new Date(now.getTime() + policy.windowMs) : null,
      });
    },
    async clear(key) {
      attempts.delete(key);
    },
  };
}

test("el rate limiter compartido bloquea intentos concurrentes y expira por ventana", async () => {
  const limiter = createLoginRateLimiter(createSharedTestStore(), { maxAttempts: 5, windowMs: 60_000 });
  const now = new Date("2026-10-25T00:00:00.000Z");
  await Promise.all(Array.from({ length: 5 }, () => limiter.recordFailedLogin("hmac-key", now)));
  assert.equal(await limiter.isAllowed("hmac-key", now), false);
  assert.equal(await limiter.isAllowed("hmac-key", new Date(now.getTime() + 60_000)), true);
  await limiter.clearLoginAttempts("hmac-key");
  assert.equal(await limiter.isAllowed("hmac-key", now), true);
});

test("el adaptador productivo usa almacenamiento PostgreSQL atómico y no un Map local", async () => {
  const source = await readFile(new URL("../lib/server/login-rate-limit.ts", import.meta.url), "utf8");
  assert.match(source, /INSERT INTO "limites_intentos_login"/);
  assert.match(source, /ON CONFLICT \("clave"\) DO UPDATE/);
  assert.match(source, /createHmac\("sha256"/);
  assert.doesNotMatch(source, /new Map\(/);
});

test("la caché real tiene vigencia acotada y no acepta valores implícitos fuera de rango", () => {
  assert.equal(getRealHlrCacheTtlMs(undefined), 30 * 24 * 60 * 60 * 1000);
  assert.equal(getRealHlrCacheTtlMs("48"), 48 * 60 * 60 * 1000);
  assert.throws(() => getRealHlrCacheTtlMs("0"), HlrApprovalLimitError);
  assert.throws(() => getRealHlrCacheTtlMs("9000"), HlrApprovalLimitError);
  assert.equal(getRealHlrCacheExpiry(new Date("2026-10-25T00:00:00.000Z"), 3_600_000).toISOString(), "2026-10-25T01:00:00.000Z");
});
