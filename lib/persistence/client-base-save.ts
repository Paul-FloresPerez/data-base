"use client";

import { buildStoredLots, serializeBatch, splitRecords } from "./workspace-persistence.ts";
import type { WorkingBatch } from "../workspace/batch.ts";

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
export async function saveBatchToHistory(batch: WorkingBatch, name: string): Promise<void> {
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
    body: JSON.stringify({ revision: start.revision, lots: buildStoredLots(batch) }),
  });
}
