import { requireAdminApi } from "@/lib/server/require-admin";
import { resolveFirstRealSozarAttempt, type FirstRealAttemptResolution } from "@/lib/server/sozar-first-real-executor";

/** Restricted administrative evidence entrypoint. It never contacts Sozar. */
export async function POST(request: Request, context: { params: Promise<{ attemptId: string }> }) {
  const session = await requireAdminApi();
  if (!session) return Response.json({ error: "No autorizado" }, { status: 401 });
  const body = await request.json().catch(() => null) as { operationId?: unknown; resolution?: unknown; evidenceReference?: unknown } | null;
  if (!body || typeof body.operationId !== "string" || typeof body.evidenceReference !== "string" || (body.resolution !== "MARCAR_INCIERTA" && body.resolution !== "NO_ENVIADA_CONFIRMADA" && body.resolution !== "MANTIENE_INCIERTA")) {
    return Response.json({ error: "Resolución administrativa inválida." }, { status: 400 });
  }
  try {
    const { attemptId } = await context.params;
    const result = await resolveFirstRealSozarAttempt({ attemptId, userId: session.user.id, operationId: body.operationId, resolution: body.resolution as FirstRealAttemptResolution, evidenceReference: body.evidenceReference });
    return Response.json(result);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "No se pudo registrar la resolución administrativa." }, { status: 409 });
  }
}
