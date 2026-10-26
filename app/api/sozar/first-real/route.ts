import { requireAdminApi } from "@/lib/server/require-admin";
import { assertFirstRealSozarTestEnabled, SozarFirstRealTestBlockedError } from "@/lib/server/sozar-first-real-gate";
import { executeFirstRealSozarTest } from "@/lib/server/sozar-first-real-executor";
import { prisma } from "@/lib/server/prisma";

/**
 * Deliberately inert administrative boundary. The eventual executor must be
 * wired only in the separately authorised release that opens all code gates.
 * It validates no mobile, performs no database write and never imports fetch.
 */
export async function POST(request: Request) {
  const session = await requireAdminApi();
  if (!session) return Response.json({ error: "No autorizado" }, { status: 401 });
  try {
    assertFirstRealSozarTestEnabled();
  } catch (error) {
    if (error instanceof SozarFirstRealTestBlockedError) {
      return Response.json({ error: "La prueba única de Sozar permanece bloqueada por código." }, { status: 423 });
    }
    throw error;
  }
  const body = await request.json().catch(() => null) as { baseId?: unknown; sourceRow?: unknown; confirmation?: unknown } | null;
  if (!body || typeof body.baseId !== "string" || !Number.isInteger(body.sourceRow) || body.confirmation !== "SOZAR_SINGLE_REAL_REQUEST") return Response.json({ error: "Solicitud de prueba inválida." }, { status: 400 });
  const result = await executeFirstRealSozarTest({ baseId: body.baseId, sourceRow: body.sourceRow as number, userId: session.user.id });
  return Response.json(result);
}

/** Administrators may review only the encrypted response schema, never JSON values. */
export async function GET() {
  if (!await requireAdminApi()) return Response.json({ error: "No autorizado" }, { status: 401 });
  const event = await prisma.eventoConsultaHlr.findUnique({
    where: { claveOperacion: "sozar:first-real-test:v1" },
    select: { consulta: { select: { estado: true, resultado: { select: { resultado: true, consultadoEn: true } } } } },
  });
  if (!event?.consulta) return Response.json({ status: "SIN_PRUEBA_REAL" });
  const stored = event.consulta.resultado?.resultado as { shape?: unknown; mapping?: unknown } | undefined;
  return Response.json({ status: event.consulta.estado, consultedAt: event.consulta.resultado?.consultadoEn?.toISOString() ?? null, shape: stored?.shape ?? null, mapping: stored?.mapping ?? null });
}
