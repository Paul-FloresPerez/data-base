import assert from "node:assert/strict";
import test from "node:test";
import { getAccessDecision } from "../lib/auth/access-control.ts";
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
