import { evaluateGlobalRecyclingExecution } from "@/lib/server/global-recycling-storage";
import { uuidPattern } from "@/lib/server/request-validation";
import { requireAdminApi } from "@/lib/server/require-admin";

export async function POST(_: Request, context: { params: Promise<{ executionId: string }> }) {
  if (!await requireAdminApi()) return Response.json({ error: "No autorizado" }, { status: 401 });
  const { executionId } = await context.params;
  if (!uuidPattern.test(executionId)) return Response.json({ error: "Ejecución no válida." }, { status: 400 });
  try { return Response.json(await evaluateGlobalRecyclingExecution(executionId)); } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "No se pudo evaluar el reciclaje global." }, { status: 409 }); }
}
