import { saveRecordChunk } from "@/lib/server/base-storage";
import { isPlainObject, isStoredRecord, readJson, uuidPattern } from "@/lib/server/request-validation";
import { requireAdminApi } from "@/lib/server/require-admin";

export async function POST(request: Request, { params }: { params: Promise<{ baseId: string }> }) {
  if (!await requireAdminApi()) return Response.json({ error: "No autorizado" }, { status: 401 });
  const { baseId } = await params;
  try {
    const payload = await readJson(request);
    if (!uuidPattern.test(baseId) || !isPlainObject(payload) || !uuidPattern.test(String(payload.revision)) || !Array.isArray(payload.records) || payload.records.length > 100 || !payload.records.every(isStoredRecord)) return Response.json({ error: "Datos de registros no válidos." }, { status: 400 });
    const complete = await saveRecordChunk(baseId, String(payload.revision), payload.records as never);
    return complete ? Response.json({ ok: true }) : Response.json({ error: "Guardado desactualizado." }, { status: 409 });
  } catch {
    return Response.json({ error: "No se pudo guardar el bloque de registros." }, { status: 400 });
  }
}
