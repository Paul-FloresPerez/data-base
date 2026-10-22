import assert from "node:assert/strict";
import test from "node:test";
import { hashPassword, verifyPasswordHash } from "../lib/server/password-hash.ts";

test("genera y verifica hashes scrypt sin conservar la contraseña", async () => {
  const password = "una-contraseña-de-prueba-segura";
  const hash = await hashPassword(password);

  assert.match(hash, /^\$scrypt\$16384\$8\$1\$/);
  assert.equal(await verifyPasswordHash(password, hash), true);
  assert.equal(await verifyPasswordHash("otra-contraseña-de-prueba", hash), false);
});

test("rechaza una contraseña demasiado corta y hashes inválidos", async () => {
  await assert.rejects(hashPassword("corta"));
  assert.equal(await verifyPasswordHash("contraseña-de-prueba", "no-es-un-hash"), false);
});
