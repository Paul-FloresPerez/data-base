import { getSavedBase } from "@/lib/server/base-storage";
import { uuidPattern } from "@/lib/server/request-validation";
import { requireAdminApi } from "@/lib/server/require-admin";

export async function GET(_request: Request, { params }: { params: Promise<{ baseId: string }> }) {
  if (!await requireAdminApi()) return Response.json({ error: "No autorizado" }, { status: 401 });
  const { baseId } = await params;
  if (!uuidPattern.test(baseId)) return Response.json({ error: "Base no encontrada." }, { status: 404 });
  const base = await getSavedBase(baseId);
  return base ? Response.json({ base }) : Response.json({ error: "Base no encontrada." }, { status: 404 });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ baseId: string }> }) {
  if (!await requireAdminApi()) return Response.json({ error: "No autorizado" }, { status: 401 });
  const { baseId } = await params;
  if (!uuidPattern.test(baseId)) return Response.json({ error: "Base no encontrada." }, { status: 404 });
  return Response.json(
    { error: "La eliminación física no está disponible. Usa el archivado lógico y reversible desde Administración." },
    { status: 405, headers: { Allow: "GET" } },
  );
}
