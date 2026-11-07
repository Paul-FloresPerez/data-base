"use client";

import { buildStoredLots, serializeBatch, splitRecords } from "./workspace-persistence.ts";
import type { WorkingBatch } from "../workspace/batch.ts";

/**
 * A restored completed base establishes this signature as its autosave
 * baseline. The blocked HLR queue is administrative browser state: it is not
 * an authorization and the server preflight does not depend on it. Excluding
 * it prevents selecting a single Sozar test candidate from rewriting an
 * otherwise complete original base in record chunks.
 *
 * Explicit base saves still serialize `realHlrQueue` for backwards-compatible
 * audit recovery; ordinary data changes continue to produce a new signature.
 */
export function batchSaveSignature(batch: WorkingBatch): string {
  const { realHlrQueue: _blockedAdministrativeQueue, ...autosaveFields } = batch;
  return JSON.stringify(autosaveFields);
}

export function needsBatchSave(lastSavedSignature: string | null, batchSignature: string): boolean {
  return lastSavedSignature !== batchSignature;
}

async function request<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: unknown } | null;
    throw new Error(typeof body?.error === "string" ? body.error : "No se pudo guardar la base.");
  }
  return response.json() as Promise<T>;
}

/**
 * The server keeps incomplete revisions out of the history. A retry starts a
 * fresh revision for the same UUID, so a failed client request never exposes a
 * partial base as usable data.
 */
export async function saveBatchToHistory(batch: WorkingBatch, name: string, options: { confirmCommercialDistribution?: boolean } = {}): Promise<void> {
  const { start, records } = serializeBatch(batch, name);
  await request("/api/bases", { method: "POST", body: JSON.stringify(start) });
  for (const chunk of splitRecords(records)) {
    await request(`/api/bases/${start.id}/registros`, {
      method: "POST",
      body: JSON.stringify({ revision: start.revision, records: chunk }),
    });
  }
  await request(`/api/bases/${start.id}/finalizar`, {
    method: "POST",
    // Autosave and "Guardar base" persist the base only. Commercial lots and
    // reservations require the explicit confirmation action in Distribución.
    body: JSON.stringify({ revision: start.revision, lots: options.confirmCommercialDistribution ? buildStoredLots(batch) : [] }),
  });
}
