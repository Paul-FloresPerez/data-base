import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { getAccessDecision } from "../lib/auth/access-control.ts";

test("las rutas de auditoría no permiten acceso anónimo", () => {
  assert.equal(getAccessDecision({ isAuthenticated: false, pathname: "/api/auditoria" }).type, "unauthorized");
  assert.equal(getAccessDecision({ isAuthenticated: false, pathname: "/api/auditoria/exportaciones" }).type, "unauthorized");
});

test("la migración de auditoría es estrictamente aditiva", async () => {
  const sql = await readFile(new URL("../prisma/migrations/20261024014500_add_audit_events/migration.sql", import.meta.url), "utf8");
  assert.match(sql, /CREATE TABLE "eventos_auditoria"/);
  assert.match(sql, /CREATE TABLE "registros_exportacion"/);
  assert.match(sql, /ON DELETE RESTRICT/);
  assert.doesNotMatch(sql, /^\s*(DROP|TRUNCATE|DELETE\s+FROM|UPDATE\s+)/im);
  assert.doesNotMatch(sql, /ALTER TABLE "(bases|registros|lotes|lote_registros|usuarios)"/);
});

test("los eventos y las exportaciones usan una operación única idempotente", async () => {
  const storage = await readFile(new URL("../lib/server/audit-storage.ts", import.meta.url), "utf8");
  assert.match(storage, /operacionId:\s*event\.operationId/);
  assert.match(storage, /skipDuplicates:\s*true/);
  assert.match(storage, /registroExportacion\.upsert\(\{/);
  assert.match(storage, /updateMany\(\{ where: \{ id: input\.id, estado: "DESCARGA_INICIADA" \}/);
});
