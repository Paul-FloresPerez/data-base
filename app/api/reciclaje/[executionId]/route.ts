import { getRecyclingExecution } from "@/lib/server/recycling-storage";
import { uuidPattern } from "@/lib/server/request-validation";
import { requireAdminApi } from "@/lib/server/require-admin";

export async function GET(_: Request, context: { params: Promise<{ executionId: string }> }) {
  if (!await requireAdminApi()) return Response.json({ error: "No autorizado" }, { status: 401 });
  const { executionId } = await context.params;
  if (!uuidPattern.test(executionId)) return Response.json({ error: "Ejecución no válida." }, { status: 400 });
  try {
    return Response.json(await getRecyclingExecution(executionId));
  } catch {
    return Response.json({ error: "Ejecución no encontrada." }, { status: 404 });
  }
}
