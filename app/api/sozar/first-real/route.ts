import { requireAdminApi } from "@/lib/server/require-admin";
import { assertFirstRealSozarTestEnabled, getFirstRealSozarTestConfiguration, SozarFirstRealTestBlockedError } from "@/lib/server/sozar-first-real-gate";
import { executeFirstRealSozarTest } from "@/lib/server/sozar-first-real-executor";
import { getFirstRealSozarCandidateHints, getFirstRealSozarSelectionContext } from "@/lib/server/sozar-first-real-selection";
import { prisma } from "@/lib/server/prisma";

/**
 * Deliberately closed administrative boundary. The executor is reachable only
 * after a separately reviewed source release opens its dedicated gate.
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
export async function GET(request: Request) {
  if (!await requireAdminApi()) return Response.json({ error: "No autorizado" }, { status: 401 });
  // This validates only the local server configuration. It does not create a
  // reservation, invoke a transport or contact the provider.
  let configurationReady = false;
  try {
    assertFirstRealSozarTestEnabled();
    getFirstRealSozarTestConfiguration();
    configurationReady = true;
  } catch {
    configurationReady = false;
  }
  const event = await prisma.eventoConsultaHlr.findUnique({
    where: { claveOperacion: "sozar:first-real-test:v1" },
    select: { consulta: { select: { estado: true, resultado: { select: { resultado: true, consultadoEn: true } } } } },
  });
  const url = new URL(request.url);
  const baseId = url.searchParams.get("baseId");
  const sourceRowRaw = url.searchParams.get("sourceRow");
  let candidates: Awaited<ReturnType<typeof getFirstRealSozarCandidateHints>> | undefined;
  let selection: Awaited<ReturnType<typeof getFirstRealSozarSelectionContext>> | undefined;
  if (baseId) {
    try {
      candidates = await getFirstRealSozarCandidateHints(baseId);
      if (sourceRowRaw !== null && /^\d+$/.test(sourceRowRaw)) {
        selection = await getFirstRealSozarSelectionContext(baseId, Number(sourceRowRaw));
      }
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : "No se pudo revisar la selección de Sozar.", configurationReady }, { status: 409 });
    }
  }
  if (!event?.consulta) return Response.json({ status: "SIN_PRUEBA_REAL", configurationReady, candidates, selection });
  const stored = event.consulta.resultado?.resultado as { shape?: unknown; mapping?: unknown } | undefined;
  return Response.json({ status: event.consulta.estado, configurationReady, consultedAt: event.consulta.resultado?.consultadoEn?.toISOString() ?? null, shape: stored?.shape ?? null, mapping: stored?.mapping ?? null, candidates, selection });
}
