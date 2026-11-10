import { createGlobalRecyclingExecution, listGlobalRecyclingExecutions } from "@/lib/server/global-recycling-storage";
import { isPlainObject, readJson, uuidPattern } from "@/lib/server/request-validation";
import { requireAdminApi } from "@/lib/server/require-admin";

export async function GET(request: Request) {
  if (!await requireAdminApi()) return Response.json({ error: "No autorizado" }, { status: 401 });
  const url = new URL(request.url);
  const page = Number(url.searchParams.get("page") ?? "0");
  const limit = Number(url.searchParams.get("limit") ?? "25");
  return Response.json(await listGlobalRecyclingExecutions({ page, limit }));
}

export async function POST(request: Request) {
  const session = await requireAdminApi();
  if (!session?.user?.id) return Response.json({ error: "No autorizado" }, { status: 401 });
  try {
    const payload = await readJson(request);
    if (!isPlainObject(payload) || !uuidPattern.test(String(payload.operationId)) || (payload.baseOriginalId !== undefined && payload.baseOriginalId !== null && !uuidPattern.test(String(payload.baseOriginalId))) || !Array.isArray(payload.archivoCrmIds) || !payload.archivoCrmIds.length || payload.archivoCrmIds.length > 100 || !payload.archivoCrmIds.every((id) => uuidPattern.test(String(id)))) return Response.json({ error: "Archivos CRM no válidos." }, { status: 400 });
    const criteria = payload.criteria;
    if (!isPlainObject(criteria) || !/^\d{4}-\d{2}-\d{2}$/.test(String(criteria.effectiveDate)) || criteria.minimumMonths !== 4 || String(criteria.minimumDate) !== "2019-02-01" || !Array.isArray(criteria.recyclableTipifications) || !criteria.recyclableTipifications.length || criteria.recyclableTipifications.length > 30 || !criteria.recyclableTipifications.every((value) => typeof value === "string" && value.length <= 120)) return Response.json({ error: "Criterios globales no válidos." }, { status: 400 });
    const result = await createGlobalRecyclingExecution({ operationId: String(payload.operationId), userId: session.user.id, archivoCrmIds: payload.archivoCrmIds.map(String), criteria: { effectiveDate: String(criteria.effectiveDate), minimumDate: "2019-02-01", minimumMonths: 4, recyclableTipifications: criteria.recyclableTipifications, baseOriginalId: typeof payload.baseOriginalId === "string" ? payload.baseOriginalId : undefined } });
    return Response.json(result, { status: result.reused ? 200 : 201 });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "No se pudo crear la ejecución global." }, { status: 400 }); }
}
