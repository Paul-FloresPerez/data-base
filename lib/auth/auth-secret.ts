/**
 * Resolves the Auth.js signing secret without ever exposing it to client code.
 *
 * `NEXTAUTH_SECRET` is the canonical name for the installed Auth.js v4
 * package. `AUTH_SECRET` is accepted as a deployment-compatible fallback.
 */
export function getAuthSecret() {
  return process.env.NEXTAUTH_SECRET?.trim() || process.env.AUTH_SECRET?.trim() || undefined;
}
