export type LoginRateLimitPolicy = {
  maxAttempts: number;
  windowMs: number;
};

export type SharedLoginRateLimitStore = {
  isAllowed(key: string, now: Date): Promise<boolean>;
  recordFailure(key: string, policy: LoginRateLimitPolicy, now: Date): Promise<void>;
  clear(key: string): Promise<void>;
};

/** Keeps policy orchestration testable while the production store is PostgreSQL. */
export function createLoginRateLimiter(store: SharedLoginRateLimitStore, policy: LoginRateLimitPolicy) {
  if (!Number.isInteger(policy.maxAttempts) || policy.maxAttempts < 1 || !Number.isInteger(policy.windowMs) || policy.windowMs < 1_000) {
    throw new Error("La política de rate limiting no es válida.");
  }

  return {
    isAllowed(key: string, now = new Date()) {
      return store.isAllowed(key, now);
    },
    recordFailedLogin(key: string, now = new Date()) {
      return store.recordFailure(key, policy, now);
    },
    clearLoginAttempts(key: string) {
      return store.clear(key);
    },
  };
}
