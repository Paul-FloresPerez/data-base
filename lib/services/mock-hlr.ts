import type { EnrichedRecord, SimulatedEnrichment, ValidRecord } from "../excel/types";

const operators = [
  "Movistar",
  "Orange",
  "Vodafone",
  "Yoigo",
  "Pepephone",
  "Euskaltel",
  "R_CABLE",
] as const;

function stableHash(value: string): number {
  let hash = 0;

  for (const character of value) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }

  return hash;
}

export function simulateHlrMnpForMobile(mobile: string): SimulatedEnrichment {
  const hash = stableHash(mobile);
  const currentIndex = hash % operators.length;
  let sourceIndex = (hash * 7 + 3) % operators.length;

  if (sourceIndex === currentIndex) {
    sourceIndex = (sourceIndex + 1) % operators.length;
  }

  const hasSimulatedPortabilityDate = hash % 4 !== 0;
  const simulatedDate = hasSimulatedPortabilityDate
    ? new Date(Date.UTC(2021 + (hash % 5), (hash >>> 4) % 12, ((hash >>> 9) % 28) + 1))
        .toISOString()
        .slice(0, 10)
    : null;

  return {
    operador_actual: operators[currentIndex],
    operador_origen: operators[sourceIndex],
    fecha_portabilidad: simulatedDate,
  };
}

export function simulateHlrMnp(records: readonly ValidRecord[]): EnrichedRecord[] {
  return records.map((record) => ({
    ...record,
    ...simulateHlrMnpForMobile(record.normalizedMobile),
  }));
}
