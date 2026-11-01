import { finalizeIntelligentRecycling } from "@/lib/server/recycling-storage";
import { uuidPattern } from "@/lib/server/request-validation";
import { requireAdminApi } from "@/lib/server/require-admin";

export async function POST(_: Request, context: { params: Promise<{ executionId: string }> }) {
  const session = await requireAdminApi();
  if (!session?.user?.id) return Response.json({ error: "No autorizado" }, { status: 401 });
  const { executionId } = await context.params;
  if (!uuidPattern.test(executionId)) return Response.json({ error: "Ejecución no válida." }, { status: 400 });
  try {
    return Response.json(await finalizeIntelligentRecycling(executionId, session.user.id));
  } catch {
    return Response.json({ error: "No se pudo finalizar el reciclaje." }, { status: 409 });
  }
}
