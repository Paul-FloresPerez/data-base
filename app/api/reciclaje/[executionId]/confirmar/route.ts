import { confirmIntelligentRecycling } from "@/lib/server/recycling-storage";
import { uuidPattern } from "@/lib/server/request-validation";
import { requireAdminApi } from "@/lib/server/require-admin";

/** Final, idempotent server-side confirmation of an evaluated recycling run. */
export async function POST(_: Request, context: { params: Promise<{ executionId: string }> }) {
  const session = await requireAdminApi();
  if (!session?.user?.id) return Response.json({ error: "No autorizado" }, { status: 401 });
  const { executionId } = await context.params;
  if (!uuidPattern.test(executionId)) return Response.json({ error: "Ejecución no válida." }, { status: 400 });
  try {
    return Response.json(await confirmIntelligentRecycling(executionId, session.user.id));
  } catch {
    return Response.json({ error: "No se pudo confirmar el reciclaje." }, { status: 409 });
  }
}
