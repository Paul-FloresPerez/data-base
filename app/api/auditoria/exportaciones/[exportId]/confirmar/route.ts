import { confirmDelivery } from "@/lib/server/audit-storage";
import { isPlainObject, readJson, uuidPattern } from "@/lib/server/request-validation";
import { requireAdminApi } from "@/lib/server/require-admin";

export async function POST(request: Request, { params }: { params: Promise<{ exportId: string }> }) {
  const session = await requireAdminApi();
  if (!session) return Response.json({ error: "No autorizado" }, { status: 401 });
  const { exportId } = await params;
  try {
    const body = await readJson(request);
    const recipient = isPlainObject(body) && typeof body.recipient === "string" ? body.recipient.trim() : "";
    if (!uuidPattern.test(exportId) || recipient.length > 180) return Response.json({ error: "Confirmación no válida." }, { status: 400 });
    return await confirmDelivery({ id: exportId, userId: session.user.id, recipient: recipient || null }) ? Response.json({ ok: true }) : Response.json({ error: "La entrega no está disponible para confirmar." }, { status: 409 });
  } catch { return Response.json({ error: "No se pudo confirmar la entrega." }, { status: 409 }); }
}
