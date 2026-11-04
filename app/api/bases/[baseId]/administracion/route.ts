import { archiveBase, getBaseAdministrativeDependencies, restoreArchivedBase } from "@/lib/server/base-archive-storage";
import { isPlainObject, readJson, uuidPattern } from "@/lib/server/request-validation";
import { requireAdminApi } from "@/lib/server/require-admin";

type Context = { params: Promise<{ baseId: string }> };

export async function GET(_: Request, context: Context) {
  const session = await requireAdminApi();
  if (!session) return Response.json({ error: "No autorizado" }, { status: 401 });
  const { baseId } = await context.params;
  if (!uuidPattern.test(baseId)) return Response.json({ error: "Base no válida." }, { status: 400 });
  const dependencies = await getBaseAdministrativeDependencies(baseId);
  return dependencies ? Response.json(dependencies) : Response.json({ error: "La base no existe." }, { status: 404 });
}

export async function POST(request: Request, context: Context) {
  const session = await requireAdminApi();
  if (!session) return Response.json({ error: "No autorizado" }, { status: 401 });
  const { baseId } = await context.params;
  try {
    const payload = await readJson(request);
    if (!uuidPattern.test(baseId) || !isPlainObject(payload) || !uuidPattern.test(String(payload.operationId))) {
      return Response.json({ error: "Solicitud administrativa no válida." }, { status: 400 });
    }
    if (payload.action === "archive") {
      if (typeof payload.reason !== "string") return Response.json({ error: "Indica un motivo de archivado." }, { status: 400 });
      return Response.json(await archiveBase({ baseId, userId: session.user.id, operationId: String(payload.operationId), reason: payload.reason }));
    }
    if (payload.action === "restore") {
      return Response.json(await restoreArchivedBase({ baseId, userId: session.user.id, operationId: String(payload.operationId) }));
    }
    return Response.json({ error: "Acción administrativa no válida." }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "No se pudo actualizar el archivado." }, { status: 400 });
  }
}
