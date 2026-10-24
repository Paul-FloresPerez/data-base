import type { ValidRecord } from "@/lib/excel/types";

export const REAL_HLR_QUEUE_VERSION = 1 as const;
export type RealHlrQueueStatus = "PREPARADA_BLOQUEADA";

export interface RealHlrQueueJob {
  /** Stable within a base and contains no mobile number. */
  idempotencyKey: string;
  sourceRow: number;
  status: "PENDIENTE_APROBACION";
}

export interface RealHlrQueuePlan {
  version: typeof REAL_HLR_QUEUE_VERSION;
  provider: "sozar";
  status: RealHlrQueueStatus;
  maxQueries: number;
  budgetLimit: number;
  preparedAt: string;
  jobs: RealHlrQueueJob[];
}

/**
 * This plan is persisted with the existing Base metadata. Re-planning the same
 * base produces the same idempotency keys instead of appending duplicate jobs.
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
  const uniqueRows = [...new Map(input.records.map((record) => [record.sourceRow, record])).values()].slice(0, input.maxQueries);
  return {
    version: REAL_HLR_QUEUE_VERSION,
    provider: "sozar",
    status: "PREPARADA_BLOQUEADA",
    maxQueries: input.maxQueries,
    budgetLimit: input.budgetLimit,
    preparedAt: input.preparedAt ?? new Date().toISOString(),
    jobs: uniqueRows.map((record) => ({
      idempotencyKey: `${input.baseId}:sozar:v1:${record.sourceRow}`,
      sourceRow: record.sourceRow,
      status: "PENDIENTE_APROBACION",
    })),
  };
}
