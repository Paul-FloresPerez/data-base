export const PROCESSING_JOB_TYPES = ["IMPORTACION", "CONCILIACION", "RECICLAJE", "EXPORTACION"] as const;
export const PROCESSING_JOB_STATES = ["PENDIENTE", "EN_PROCESO", "RECUPERABLE", "COMPLETADO", "FALLIDO", "CANCELADO"] as const;

export type ProcessingJobType = (typeof PROCESSING_JOB_TYPES)[number];
export type ProcessingJobState = (typeof PROCESSING_JOB_STATES)[number];

export const DEFAULT_PROCESSING_JOB_MAX_ATTEMPTS = 3;
export const MAX_PROCESSING_JOB_MAX_ATTEMPTS = 20;
export const MAX_PROCESSING_JOB_BLOCKS = 500_000;

export function assertProcessingJobShape(blockCount: number, maxAttempts: number) {
  if (!Number.isInteger(blockCount) || blockCount < 1 || blockCount > MAX_PROCESSING_JOB_BLOCKS) {
    throw new Error("El número de bloques del trabajo no es válido.");
  }
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > MAX_PROCESSING_JOB_MAX_ATTEMPTS) {
    throw new Error("El máximo de intentos del trabajo no es válido.");
  }
}

export function isProcessingJobType(value: string): value is ProcessingJobType {
  return (PROCESSING_JOB_TYPES as readonly string[]).includes(value);
}

export function progressPercentage(completed: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(100, Math.max(0, Math.floor((completed * 100) / total)));
}
