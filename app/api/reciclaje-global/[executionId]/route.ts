import { getGlobalRecyclingExecution } from "@/lib/server/global-recycling-storage";
import { uuidPattern } from "@/lib/server/request-validation";
import { requireAdminApi } from "@/lib/server/require-admin";

export async function GET(request: Request, context: { params: Promise<{ executionId: string }> }) {
  if (!await requireAdminApi()) return Response.json({ error: "No autorizado" }, { status: 401 });
  const { executionId } = await context.params;
  if (!uuidPattern.test(executionId)) return Response.json({ error: "Ejecución no válida" }, { status: 400 });
  const url = new URL(request.url);
  const detail = await getGlobalRecyclingExecution(executionId, { cursor: url.searchParams.get("cursor") ?? undefined, limit: Number(url.searchParams.get("limit") ?? "50") });
  return detail ? Response.json(detail) : Response.json({ error: "No encontrada" }, { status: 404 });
}
