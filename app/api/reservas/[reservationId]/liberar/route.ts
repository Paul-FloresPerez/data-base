import { releaseCommercialReservation } from "@/lib/server/commercial-reservation-storage";
import { isPlainObject, readJson, uuidPattern } from "@/lib/server/request-validation";
import { requireAdminApi } from "@/lib/server/require-admin";

export async function POST(request: Request, { params }: { params: Promise<{ reservationId: string }> }) {
  const session = await requireAdminApi();
  if (!session?.user?.id) return Response.json({ error: "No autorizado" }, { status: 401 });
  const { reservationId } = await params;
  try {
    const body = await readJson(request);
    if (!uuidPattern.test(reservationId) || !isPlainObject(body) || !uuidPattern.test(String(body.operationId))) {
      return Response.json({ error: "Liberación no válida." }, { status: 400 });
    }
    const released = await releaseCommercialReservation({ id: reservationId, userId: session.user.id, operationId: String(body.operationId) });
    return released ? Response.json({ ok: true }) : Response.json({ error: "La reserva no está disponible para liberar." }, { status: 409 });
  } catch {
    return Response.json({ error: "No se pudo liberar la reserva." }, { status: 409 });
  }
}
