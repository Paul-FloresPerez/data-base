import { listSavedBases, beginBaseSave } from "@/lib/server/base-storage";
import { isPlainObject, readJson, uuidPattern } from "@/lib/server/request-validation";
import { requireAdminApi } from "@/lib/server/require-admin";

function isReceiptDate(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export async function GET() {
  if (!await requireAdminApi()) return Response.json({ error: "No autorizado" }, { status: 401 });
  return Response.json({ bases: await listSavedBases() });
}

export async function POST(request: Request) {
  if (!await requireAdminApi()) return Response.json({ error: "No autorizado" }, { status: 401 });
  try {
    const payload = await readJson(request);
    const metadata = isPlainObject(payload) && isPlainObject(payload.metadata) ? payload.metadata : null;
    if (!isPlainObject(payload) || !uuidPattern.test(String(payload.id)) || !uuidPattern.test(String(payload.revision)) || typeof payload.name !== "string" || !payload.name.trim() || payload.name.trim().length > 180 || !isReceiptDate(payload.receivedAt) || (payload.originalBaseId !== null && payload.originalBaseId !== undefined && !uuidPattern.test(String(payload.originalBaseId))) || !Number.isInteger(payload.expectedRecords) || Number(payload.expectedRecords) < 0 || Number(payload.expectedRecords) > 10_000 || !Number.isInteger(payload.validRecords) || !Number.isInteger(payload.excludedRecords) || !["LISTA_PARA_LIMPIAR", "LISTA_PARA_ENRIQUECER", "LISTA_PARA_DISTRIBUIR"].includes(String(payload.state)) || !metadata || metadata.version !== 1 || typeof metadata.originalFileName !== "string" || (metadata.recyclingExecutionId !== null && metadata.recyclingExecutionId !== undefined && !uuidPattern.test(String(metadata.recyclingExecutionId))) || !Array.isArray(metadata.columns) || !metadata.columns.every((column) => typeof column === "string" && column.length <= 500) || !isPlainObject(metadata.columnMapping) || (metadata.enrichmentColumns !== null && !Array.isArray(metadata.enrichmentColumns)) || !isPlainObject(metadata.distribution) || !Array.isArray(metadata.distribution.selectedCampaigns)) {
      return Response.json({ error: "Datos de guardado no válidos." }, { status: 400 });
    }
    await beginBaseSave(payload as never);
    return Response.json({ ok: true }, { status: 201 });
  } catch {
    return Response.json({ error: "No se pudo iniciar el guardado." }, { status: 400 });
  }
}
