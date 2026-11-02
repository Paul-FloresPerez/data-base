import assert from "node:assert/strict";
import test from "node:test";

import { assertCommercialLotsIntegrity, assertCompletedRecordIntegrity, assertIncomingRecordIntegrity, assertLotsIntegrity, deriveRecordsIntegrity } from "../lib/server/base-integrity.ts";
import type { SavedLot, StoredRecord } from "../lib/persistence/workspace-persistence.ts";

const mapping = { movil: 0, nombre: 1, enriched: {} };

function record(sourceRow: number, mobile: string, overrides: Partial<StoredRecord> = {}): StoredRecord {
  return {
    sourceRow,
    cells: [mobile, "Nombre"],
    mobile,
    document: "",
    name: "Nombre",
    contactPhone: "",
    normalizedMobile: mobile.replace(/^(\+34|0034)[\s-]?/, "").replace(/[\s-]/g, ""),
    reason: null,
    tipification: "VALIDO",
    enrichedCells: null,
    provenance: "EXCEL",
    ...overrides,
  };
}

test("el servidor normaliza únicamente móviles españoles 6/7 y no acepta un normalizado manipulado", () => {
  const valid = record(2, "+34 612 345 678", { normalizedMobile: "612345678" });
  assert.doesNotThrow(() => assertIncomingRecordIntegrity([valid], mapping));
  assert.throws(() => assertIncomingRecordIntegrity([record(3, "912345678", { normalizedMobile: "612345678" })], mapping), /no coincide/);
  assert.throws(() => assertIncomingRecordIntegrity([record(4, "612345678", { normalizedMobile: "712345678" })], mapping), /no coincide/);
  assert.throws(() => assertIncomingRecordIntegrity([record(5, "612345678", { cells: ["712345678", "Nombre"] })], mapping), /columna móvil original/);
});

test("conserva registros inválidos y los deriva como incidencias sin volverlos operativos", () => {
  const records = [
    record(2, "612345678"),
    record(3, "912345678", { normalizedMobile: null, reason: "telefono_fijo", tipification: "TELEFONO_FIJO" }),
    record(4, "", { normalizedMobile: null, reason: "telefono_vacio", tipification: "TELEFONO_VACIO" }),
  ];
  const derived = assertCompletedRecordIntegrity(records, mapping, "LISTA_PARA_ENRIQUECER");
  assert.equal(derived.get(2)?.tipification, "VALIDO");
  assert.equal(derived.get(3)?.reason, "telefono_fijo");
  assert.equal(derived.get(4)?.reason, "telefono_vacio");
});

test("deduplica por móvil normalizado sobre toda la base y detecta resultados de limpieza alterados", () => {
  const records = [
    record(2, "+34 612 345 678"),
    record(3, "0034 612345678", { normalizedMobile: null, reason: "telefono_duplicado", tipification: "TELEFONO_DUPLICADO" }),
  ];
  const derived = deriveRecordsIntegrity(records, mapping);
  assert.equal(derived.get(3)?.reason, "telefono_duplicado");
  assert.doesNotThrow(() => assertCompletedRecordIntegrity(records, mapping, "LISTA_PARA_ENRIQUECER"));
  assert.throws(() => assertCompletedRecordIntegrity([records[0]!, record(3, "0034 612345678")], mapping, "LISTA_PARA_ENRIQUECER"), /no coinciden/);
});

test("rechaza filas repetidas y lotes fuera de la base, duplicados o de más de 100", () => {
  assert.throws(() => assertIncomingRecordIntegrity([record(2, "612345678"), record(2, "712345678")], mapping), /duplicadas/);
  const derived = deriveRecordsIntegrity([record(2, "612345678"), record(3, "712345678")], mapping);
  const validLot: SavedLot = { campaign: "YOIGO", number: 1, sourceRows: [2, 3] };
  assert.doesNotThrow(() => assertLotsIntegrity([validLot], derived));
  assert.throws(() => assertLotsIntegrity([{ ...validLot, sourceRows: [2, 2] }], derived), /repetirse/);
  assert.throws(() => assertLotsIntegrity([{ ...validLot, sourceRows: [99] }], derived), /ajenos/);
  assert.throws(() => assertLotsIntegrity([{ ...validLot, sourceRows: Array.from({ length: 101 }, () => 2) }], derived), /1 y 100/);
});

test("el servidor rechaza lotes manipulados fuera de la matriz y datos MOCK", () => {
  const yoigoLot: SavedLot = { campaign: "YOIGO", number: 1, sourceRows: [2] };
  assert.doesNotThrow(() => assertCommercialLotsIntegrity(yoigoLot ? [yoigoLot] : [], [{ sourceRow: 2, operadorActual: "Vodafone", provenance: "API_REAL" }]));
  assert.throws(() => assertCommercialLotsIntegrity([yoigoLot], [{ sourceRow: 2, operadorActual: "Orange", provenance: "API_REAL" }]), /matriz comercial/);
  assert.throws(() => assertCommercialLotsIntegrity([yoigoLot], [{ sourceRow: 2, operadorActual: "Vodafone", provenance: "MOCK" }]), /matriz comercial/);
  assert.throws(() => assertCommercialLotsIntegrity([yoigoLot], [{ sourceRow: 2, operadorActual: "Desconocido", provenance: "API_REAL" }]), /matriz comercial/);
});

test("valida 10.000 registros de una base sin convertir móviles inválidos en elegibles", () => {
  const records = Array.from({ length: 10_000 }, (_, index) => {
    const mobile = `6${String(index).padStart(8, "0")}`;
    return record(index + 2, mobile);
  });
  const derived = deriveRecordsIntegrity(records, mapping);
  assert.equal(derived.size, 10_000);
  assert.equal([...derived.values()].filter((item) => item.tipification === "VALIDO").length, 10_000);
});
