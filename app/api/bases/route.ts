import { listSavedBases, beginBaseSave, searchOriginalBases } from "@/lib/server/base-storage";
import { isPlainObject, readJson, uuidPattern } from "@/lib/server/request-validation";
import { requireAdminApi } from "@/lib/server/require-admin";

function isReceiptDate(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function isColumnMapping(value: unknown, columnCount: number): boolean {
  if (!isPlainObject(value) || !Number.isInteger(value.movil) || Number(value.movil) < 0 || Number(value.movil) >= columnCount || !isPlainObject(value.enriched)) return false;
  for (const field of [value.documento, value.nombre, value.telefono_contacto]) {
    if (field !== undefined && (!Number.isInteger(field) || Number(field) < 0 || Number(field) >= columnCount)) return false;
  }
  return Object.values(value.enriched).every((field) => Number.isInteger(field) && Number(field) >= 0 && Number(field) < columnCount);
}

function asBoundedInteger(value: string | null, fallback: number, maximum: number): number | null {
  if (value === null) return fallback;
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed <= maximum ? parsed : null;
}

export async function GET(request: Request) {
  if (!await requireAdminApi()) return Response.json({ error: "No autorizado" }, { status: 401 });
  const url = new URL(request.url);
  if (url.searchParams.get("purpose") === "original-selector") {
    const query = url.searchParams.get("q") ?? "";
    const page = asBoundedInteger(url.searchParams.get("page"), 0, 10_000);
    const limit = asBoundedInteger(url.searchParams.get("limit"), 12, 25);
    const selectedId = url.searchParams.get("selectedId");
    if (query.length > 120 || page === null || limit === null || (selectedId && !uuidPattern.test(selectedId))) {
      return Response.json({ error: "Búsqueda de base no válida." }, { status: 400 });
    }
    return Response.json(await searchOriginalBases({ query, page, limit, selectedId }));
  }
  return Response.json({ bases: await listSavedBases() });
}

export async function POST(request: Request) {
  if (!await requireAdminApi()) return Response.json({ error: "No autorizado" }, { status: 401 });
  try {
    const payload = await readJson(request);
    const metadata = isPlainObject(payload) && isPlainObject(payload.metadata) ? payload.metadata : null;
    if (!isPlainObject(payload) || !uuidPattern.test(String(payload.id)) || !uuidPattern.test(String(payload.revision)) || typeof payload.name !== "string" || !payload.name.trim() || payload.name.trim().length > 180 || !isReceiptDate(payload.receivedAt) || (payload.originalBaseId !== null && payload.originalBaseId !== undefined && !uuidPattern.test(String(payload.originalBaseId))) || !Number.isInteger(payload.expectedRecords) || Number(payload.expectedRecords) < 0 || Number(payload.expectedRecords) > 10_000 || !Number.isInteger(payload.validRecords) || !Number.isInteger(payload.excludedRecords) || Number(payload.validRecords) < 0 || Number(payload.excludedRecords) < 0 || Number(payload.validRecords) + Number(payload.excludedRecords) > Number(payload.expectedRecords) || !["LISTA_PARA_LIMPIAR", "LISTA_PARA_ENRIQUECER", "LISTA_PARA_DISTRIBUIR"].includes(String(payload.state)) || !metadata || metadata.version !== 1 || typeof metadata.originalFileName !== "string" || (metadata.kind !== undefined && metadata.kind !== "ORIGINAL" && metadata.kind !== "RECICLADA") || (metadata.recyclingExecutionId !== null && metadata.recyclingExecutionId !== undefined && !uuidPattern.test(String(metadata.recyclingExecutionId))) || !Array.isArray(metadata.columns) || !metadata.columns.every((column) => typeof column === "string" && column.length <= 500) || !isColumnMapping(metadata.columnMapping, metadata.columns.length) || (metadata.enrichmentColumns !== null && !Array.isArray(metadata.enrichmentColumns)) || !isPlainObject(metadata.distribution) || !Number.isInteger(metadata.distribution.batchSize) || Number(metadata.distribution.batchSize) < 1 || Number(metadata.distribution.batchSize) > 100 || !Array.isArray(metadata.distribution.selectedCampaigns) || !metadata.distribution.selectedCampaigns.every((campaign) => campaign === "yoigo" || campaign === "vodafone") || new Set(metadata.distribution.selectedCampaigns).size !== metadata.distribution.selectedCampaigns.length) {
      return Response.json({ error: "Datos de guardado no válidos." }, { status: 400 });
    }
    await beginBaseSave(payload as never);
    return Response.json({ ok: true }, { status: 201 });
  } catch {
    return Response.json({ error: "No se pudo iniciar el guardado." }, { status: 400 });
  }
}
