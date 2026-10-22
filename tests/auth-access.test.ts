import assert from "node:assert/strict";
import test from "node:test";
import { getAccessDecision } from "../lib/auth/access-control.ts";
import { getAuthSecret } from "../lib/auth/auth-secret.ts";
import { LOGOUT_REDIRECT_PATH } from "../lib/auth/constants.ts";

test("redirige una página privada sin sesión a login conservando el destino", () => {
  assert.deepEqual(
    getAccessDecision({ isAuthenticated: false, pathname: "/", search: "?tab=campanas" }),
    { type: "redirect", location: "/login?callbackUrl=%2F%3Ftab%3Dcampanas" },
  );
});

test("rechaza una API privada sin sesión", () => {
  assert.deepEqual(
    getAccessDecision({ isAuthenticated: false, pathname: "/api/bases" }),
    { type: "unauthorized" },
  );
});

test("el cierre de sesión siempre vuelve a login", () => {
  assert.equal(LOGOUT_REDIRECT_PATH, "/login");
});

test("acepta AUTH_SECRET como respaldo seguro de NEXTAUTH_SECRET", () => {
  const originalNextAuthSecret = process.env.NEXTAUTH_SECRET;
  const originalAuthSecret = process.env.AUTH_SECRET;

  try {
    process.env.NEXTAUTH_SECRET = "   ";
    process.env.AUTH_SECRET = "  test-auth-secret  ";

    assert.equal(getAuthSecret(), "test-auth-secret");
  } finally {
    if (originalNextAuthSecret === undefined) {
      delete process.env.NEXTAUTH_SECRET;
    } else {
      process.env.NEXTAUTH_SECRET = originalNextAuthSecret;
    }

    if (originalAuthSecret === undefined) {
      delete process.env.AUTH_SECRET;
    } else {
      process.env.AUTH_SECRET = originalAuthSecret;
    }
  }
});
