import { completeBaseSave } from "@/lib/server/base-storage";
import { isPlainObject, readJson, uuidPattern } from "@/lib/server/request-validation";
import { requireAdminApi } from "@/lib/server/require-admin";

export async function POST(request: Request, { params }: { params: Promise<{ baseId: string }> }) {
  const session = await requireAdminApi();
  if (!session) return Response.json({ error: "No autorizado" }, { status: 401 });
  const { baseId } = await params;
  try {
    const payload = await readJson(request);
    if (!uuidPattern.test(baseId) || !isPlainObject(payload) || !uuidPattern.test(String(payload.revision)) || !Array.isArray(payload.lots)) return Response.json({ error: "Datos de finalización no válidos." }, { status: 400 });
    const lots = payload.lots;
    if (!lots.every((lot) => isPlainObject(lot) && (lot.campaign === "YOIGO" || lot.campaign === "VODAFONE") && Number.isInteger(lot.number) && Number(lot.number) > 0 && Array.isArray(lot.sourceRows) && lot.sourceRows.length <= 100 && lot.sourceRows.every(Number.isInteger))) return Response.json({ error: "Lotes no válidos." }, { status: 400 });
    const complete = await completeBaseSave(baseId, String(payload.revision), lots as never, session.user.id);
    return complete ? Response.json({ ok: true }) : Response.json({ error: "Guardado desactualizado." }, { status: 409 });
  } catch {
    return Response.json({ error: "No se pudo finalizar el guardado." }, { status: 409 });
  }
}
