import { normalizeSpanishMobile } from "../excel/cleaning.ts";
import type { ValidRecord } from "../excel/types.ts";

export const REAL_HLR_QUEUE_VERSION = 2 as const;
export type RealHlrQueueStatus = "PREPARADA_BLOQUEADA";

export interface LegacyRealHlrQueueJob {
  /** Version 1, retained only so already saved plans can still be opened. */
  idempotencyKey: string;
  sourceRow: number;
  status: "PENDIENTE_APROBACION";
}

export interface RealHlrQueueJob {
  /** The only contact payload planned for the future provider request. */
  normalizedMobile: string;
  /** Stable by base and normalized mobile; never by spreadsheet row. */
  idempotencyKey: string;
  status: "PENDIENTE_APROBACION";
}

interface RealHlrQueuePlanBase {
  provider: "sozar";
  status: RealHlrQueueStatus;
  maxQueries: number;
  budgetLimit: number;
  preparedAt: string;
}

export interface LegacyRealHlrQueuePlan extends RealHlrQueuePlanBase {
  version: 1;
  jobs: LegacyRealHlrQueueJob[];
}

export interface RealHlrQueuePlan extends RealHlrQueuePlanBase {
  version: typeof REAL_HLR_QUEUE_VERSION;
  jobs: RealHlrQueueJob[];
}

export type StoredRealHlrQueuePlan = LegacyRealHlrQueuePlan | RealHlrQueuePlan;

/**
 * This plan is persisted with the existing Base metadata. Re-planning the same
 * base produces the same idempotency keys instead of appending duplicate jobs.
 * The plan contains only normalized mobiles; it never carries row positions or
 * any names, documents, addresses, or workbook columns.
 */
export function prepareDisabledRealHlrQueue(input: {
  baseId: string;
  records: readonly ValidRecord[];
  maxQueries: number;
  budgetLimit: number;
  preparedAt?: string;
}): RealHlrQueuePlan {
  if (!Number.isInteger(input.maxQueries) || input.maxQueries < 1) throw new Error("El límite de consultas debe ser mayor que cero.");
  if (!Number.isFinite(input.budgetLimit) || input.budgetLimit < 0) throw new Error("El presupuesto máximo no es válido.");
  const normalizedRecords = input.records.map((record) => {
    const normalizedMobile = normalizeSpanishMobile(record.normalizedMobile);
    if (!normalizedMobile || normalizedMobile !== record.normalizedMobile) {
      throw new Error("La cola HLR solo admite móviles españoles normalizados que comiencen por 6 o 7.");
    }
    return { ...record, normalizedMobile };
  });
  const uniqueMobiles = [...new Map(normalizedRecords.map((record) => [record.normalizedMobile, record])).values()].slice(0, input.maxQueries);
  return {
    version: REAL_HLR_QUEUE_VERSION,
    provider: "sozar",
    status: "PREPARADA_BLOQUEADA",
    maxQueries: input.maxQueries,
    budgetLimit: input.budgetLimit,
    preparedAt: input.preparedAt ?? new Date().toISOString(),
    jobs: uniqueMobiles.map((record) => ({
      normalizedMobile: record.normalizedMobile,
      idempotencyKey: `${input.baseId}:sozar:v2:${record.normalizedMobile}`,
      status: "PENDIENTE_APROBACION",
    })),
  };
}
