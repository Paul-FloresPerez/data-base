import "server-only";

const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000;

type Attempt = {
  count: number;
  resetAt: number;
};

const globalForLoginAttempts = globalThis as typeof globalThis & {
  loginAttempts?: Map<string, Attempt>;
};

const attempts = globalForLoginAttempts.loginAttempts ?? new Map<string, Attempt>();

if (process.env.NODE_ENV !== "production") {
  globalForLoginAttempts.loginAttempts = attempts;
}

function getCurrentAttempt(key: string, now = Date.now()) {
  const attempt = attempts.get(key);

  if (attempt && attempt.resetAt <= now) {
    attempts.delete(key);
    return undefined;
  }

  return attempt;
}

export function isLoginAllowed(key: string) {
  return (getCurrentAttempt(key)?.count ?? 0) < MAX_ATTEMPTS;
}

export function recordFailedLogin(key: string) {
  const now = Date.now();
  const current = getCurrentAttempt(key, now);

  attempts.set(key, {
    count: (current?.count ?? 0) + 1,
    resetAt: current?.resetAt ?? now + WINDOW_MS,
  });
}

export function clearLoginAttempts(key: string) {
  attempts.delete(key);
}
