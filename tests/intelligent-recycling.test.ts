import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { evaluateIntelligentRecycling, minimumPortabilityDate, normalizeRecyclingTipification } from "../lib/recycling/intelligent-recycling.ts";

const criteria = (effectiveDate: string) => ({ effectiveDate, recyclableTipifications: ["NO CONTESTA", "BUZÓN DE VOZ", "AGENDADO"], minimumMonths: 4, minimumDate: minimumPortabilityDate });
const original = (id: string, mobile: string, portabilityDate: string | null) => ({ id, mobile, portabilityDate });
const management = (id: string, mobile: string, managedAt: string | null, tipificationOriginal: string | null, confirmedSale = false) => ({ id, mobile, managedAt, tipificationOriginal, confirmedSale, saleEvidence: confirmedSale ? "Venta confirmada sintética" : null });

test("una venta confirmada bloquea una tipificación reciclable contradictoria", () => {
  const result = evaluateIntelligentRecycling([original("r1", "612345678", "2025-01-01")], [management("m1", "612345678", "2025-06-02", "NO CONTESTA"), management("m2", "612345678", "2025-01-03", "NO CONTESTA", true)], criteria("2025-06-30"));
  assert.equal(result.decisions[0]?.decision, "BLOQUEADO_VENTA");
});

test("una reserva comercial activa no vuelve elegible un móvil aunque su gestión y permanencia cumplan", () => {
  const result = evaluateIntelligentRecycling(
    [original("r1", "612345678", "2025-01-01")],
    [management("m1", "612345678", "2025-06-02", "NO CONTESTA")],
    criteria("2025-06-30"),
    new Set(),
    new Set(["612345678"]),
  );
  assert.equal(result.decisions[0]?.decision, "REVISION_CONFLICTO");
  assert.match(result.decisions[0]?.reason ?? "", /Reserva comercial activa/);
});

test("un dato de venta ambiguo no se distribuye automáticamente", () => {
  const result = evaluateIntelligentRecycling([original("r1", "612345678", "2025-01-01")], [{ ...management("m1", "612345678", "2025-06-02", "NO CONTESTA"), saleAmbiguous: true }], criteria("2025-06-30"));
  assert.equal(result.decisions[0]?.decision, "REVISION_CONFLICTO");
});

test("conserva la precedencia por fecha, incidencias ajenas y tipificaciones desconocidas", () => {
  const result = evaluateIntelligentRecycling([original("r1", "612345678", "2025-01-01"), original("r2", "712345678", "2025-01-01")], [management("old", "612345678", "2025-04-01", "OTRA"), management("new", "612345678", "2025-06-01", "  buzon de voz "), management("unknown", "712345678", "2025-06-01", "DESCONOCIDA"), management("outside", "622345678", "2025-06-01", "NO CONTESTA")], criteria("2025-07-01"));
  assert.equal(result.decisions[0]?.decision, "ELEGIBLE");
  assert.equal(result.decisions[1]?.decision, "REVISION_GESTION");
  assert.equal(result.incidentsOutsideBase, 1);
  assert.equal(normalizeRecyclingTipification(" no responde "), "NO CONTESTA");
});

test("recalcula cuatro meses completos sin alterar la fecha de portabilidad", () => {
  const inputs = [original("r1", "612345678", "2025-02-01")];
  const events = [management("m1", "612345678", "2025-06-01", "AGENDADO")];
  assert.equal(evaluateIntelligentRecycling(inputs, events, criteria("2025-05-31")).decisions[0]?.decision, "REVISION_PERMANENCIA");
  assert.equal(evaluateIntelligentRecycling(inputs, events, criteria("2025-06-01")).decisions[0]?.decision, "ELEGIBLE");
});

test("deja en revisión fechas ausentes, inválidas y anteriores al mínimo histórico", () => {
  const result = evaluateIntelligentRecycling([original("missing", "612345678", null), original("old", "712345678", "2019-01-31"), original("invalid", "622345678", "2025-02-31")], [management("m1", "612345678", "2025-06-01", "NO CONTESTA"), management("m2", "712345678", "2025-06-01", "NO CONTESTA"), management("m3", "622345678", "2025-06-01", "NO CONTESTA")], criteria("2025-06-01"));
  assert.deepEqual(result.decisions.map((entry) => entry.decision), ["REVISION_PERMANENCIA", "FUERA_RANGO_HISTORICO", "REVISION_PERMANENCIA"]);
});

test("evalúa diez mil registros sin mezclar bases que compartan móviles", () => {
  const originals = Array.from({ length: 10_000 }, (_, index) => original(`r${index}`, `6${String(index).padStart(8, "0")}`, "2025-01-01"));
  const events = originals.map((entry, index) => management(`m${index}`, entry.mobile!, "2025-06-01", "NO CONTESTA"));
  const result = evaluateIntelligentRecycling(originals, events, criteria("2025-06-01"));
  assert.equal(result.summary.ELEGIBLE, 10_000);
  assert.equal(evaluateIntelligentRecycling([original("other", "612345678", "2025-01-01")], [], criteria("2025-06-01")).decisions[0]?.decision, "REVISION_GESTION");
});

test("las rutas de reciclaje requieren sesión administrativa y no importan Sozar", async () => {
  const routes = await Promise.all([
    "../app/api/reciclaje/route.ts",
    "../app/api/reciclaje/[executionId]/route.ts",
    "../app/api/reciclaje/[executionId]/gestiones/route.ts",
    "../app/api/reciclaje/[executionId]/finalizar/route.ts",
    "../app/api/reciclaje/[executionId]/confirmar/route.ts",
  ].map((path) => readFile(new URL(path, import.meta.url), "utf8")));
  for (const route of routes) {
    assert.match(route, /requireAdminApi/);
    assert.doesNotMatch(route, /sozar|fetch\(/i);
  }
});

test("la confirmación crea una única base derivada desde el snapshot del servidor", async () => {
  const storage = await readFile(new URL("../lib/server/recycling-storage.ts", import.meta.url), "utf8");
  assert.match(storage, /export async function confirmIntelligentRecycling/);
  assert.match(storage, /prisma\.\$transaction\(async \(tx\)/);
  assert.match(storage, /estado: "EVALUADA", baseRecicladaId: null/);
  assert.match(storage, /data: \{ estado: "EVALUANDO" \}/);
  assert.match(storage, /baseRecicladaId: recycled\.id, estado: "BASE_GENERADA"/);
  assert.match(storage, /eligibleIds = new Set\(execution\.resultados/);
  assert.match(storage, /lockCommercialMobiles\(tx, mobiles\)/);
  assert.match(storage, /estado: "ACTIVA"/);
  assert.doesNotMatch(storage, /sozar|fetch\(/i);
});
