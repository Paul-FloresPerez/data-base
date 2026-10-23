import { deleteSavedBase, getSavedBase } from "@/lib/server/base-storage";
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
  try { await deleteSavedBase(baseId); return Response.json({ ok: true }); } catch { return Response.json({ error: "Base no encontrada." }, { status: 404 }); }
}
