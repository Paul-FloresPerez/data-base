import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("el archivado lógico conserva historial, no libera reservas y excluye trabajo operativo", async () => {
  const [schema, migration, service, storage, global] = await Promise.all([
    readFile(new URL("../prisma/schema.prisma", import.meta.url), "utf8"),
    readFile(new URL("../prisma/migrations/20261105090000_add_base_logical_archive/migration.sql", import.meta.url), "utf8"),
    readFile(new URL("../lib/server/base-archive-storage.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/server/base-storage.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/server/global-recycling-storage.ts", import.meta.url), "utf8"),
  ]);
  assert.match(schema, /archivadaEn\s+DateTime\?/);
  assert.match(schema, /motivoArchivado\s+String\?/);
  assert.match(schema, /BASE_ARCHIVADA/);
  assert.doesNotMatch(migration, /DROP|TRUNCATE|DELETE\s+FROM/i);
  assert.match(service, /activeReservations/);
  assert.match(service, /BASE_ARCHIVADA/);
  assert.match(service, /BASE_RESTAURADA/);
  assert.doesNotMatch(service, /reservaComercial\.delete|estado:\s*"LIBERADA"/);
  assert.match(storage, /archivadaEn: null/);
  assert.match(storage, /no admite distribución ni guardado operativo/);
  assert.match(global, /archivadaEn: null/);
});
