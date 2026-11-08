import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("la transición global solo cierra reservas capturadas y crea su reemplazo atómicamente", async () => {
  const [baseStorage, reservationStorage, globalStorage] = await Promise.all([
    readFile(new URL("../lib/server/base-storage.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/server/commercial-reservation-storage.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/server/global-recycling-storage.ts", import.meta.url), "utf8"),
  ]);
  assert.match(baseStorage, /lockCommercialMobiles\(transaction, mobilesToDistribute\)/);
  assert.match(baseStorage, /globalRecyclingExecutionId/);
  assert.match(baseStorage, /transitionCommercialReservations\(transaction/);
  assert.match(baseStorage, /createCommercialReservations\(transaction/);
  assert.match(baseStorage, /preservedGlobalTransition/);
  assert.match(baseStorage, /editableOperationalSave\) && !generatedRecycledBase/);
  assert.match(baseStorage, /decision: "ELEGIBLE"/);
  assert.match(reservationStorage, /TRANSICION_RECICLAJE_AUTORIZADA/);
  assert.match(reservationStorage, /operacionLiberacionId/);
  assert.match(reservationStorage, /snapshot de reciclaje/);
  assert.match(globalStorage, /activeReservationIds/);
  assert.match(globalStorage, /reserva anterior se transferirá atómicamente/);
  assert.equal(reservationStorage.includes("deleteMany"), false);
  const locks = await readFile(new URL("../lib/server/commercial-locks.ts", import.meta.url), "utf8");
  assert.match(locks, /unnest\(ARRAY\[/);
  assert.match(locks, /ORDER BY movil/);
});
