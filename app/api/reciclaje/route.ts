import { beginIntelligentRecycling, listRecyclingHistory } from "@/lib/server/recycling-storage";
import { isPlainObject, readJson, uuidPattern } from "@/lib/server/request-validation";
import { requireAdminApi } from "@/lib/server/require-admin";

const datePattern = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: Request) {
  if (!await requireAdminApi()) return Response.json({ error: "No autorizado" }, { status: 401 });
  const baseId = new URL(request.url).searchParams.get("baseId") ?? "";
  if (!uuidPattern.test(baseId)) return Response.json({ error: "Base original no válida." }, { status: 400 });
  return Response.json({ executions: await listRecyclingHistory(baseId) });
}

export async function POST(request: Request) {
  const session = await requireAdminApi();
  if (!session?.user?.id) return Response.json({ error: "No autorizado" }, { status: 401 });
  try {
    const payload = await readJson(request);
    if (!isPlainObject(payload) || !uuidPattern.test(String(payload.operationId)) || !uuidPattern.test(String(payload.baseOriginalId)) || !isPlainObject(payload.criteria) || !Array.isArray(payload.files) || payload.files.length > 500 || !payload.files.every((file) => isPlainObject(file) && uuidPattern.test(String(file.importId)) && typeof file.name === "string" && file.name.trim().length > 0 && file.name.length <= 180)) {
      return Response.json({ error: "Solicitud de reciclaje no válida." }, { status: 400 });
    }
    const criteria = payload.criteria;
    if (!datePattern.test(String(criteria.effectiveDate)) || !datePattern.test(String(criteria.minimumDate)) || criteria.minimumMonths !== 4 || !Array.isArray(criteria.recyclableTipifications) || criteria.recyclableTipifications.length > 30 || !criteria.recyclableTipifications.every((tipification) => typeof tipification === "string" && tipification.length <= 120)) {
      return Response.json({ error: "Criterios de reciclaje no válidos." }, { status: 400 });
    }
    const result = await beginIntelligentRecycling({ operationId: String(payload.operationId), baseOriginalId: String(payload.baseOriginalId), userId: session.user.id, criteria: { effectiveDate: String(criteria.effectiveDate), minimumDate: String(criteria.minimumDate), minimumMonths: 4, recyclableTipifications: criteria.recyclableTipifications as string[] }, files: payload.files.map((file) => ({ importId: String(file.importId), name: String(file.name).trim() })) });
    return Response.json(result, { status: result.reused ? 200 : 201 });
  } catch (error) {
    // beginIntelligentRecycling exposes only fixed, operator-facing validation
    // messages. Returning it here lets the UI distinguish a broken saved base
    // from an ordinary no-match conciliation without leaking database details.
    return Response.json({ error: error instanceof Error ? error.message : "No se pudo iniciar el reciclaje." }, { status: 400 });
  }
}
