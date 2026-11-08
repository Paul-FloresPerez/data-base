import { requireAdminApi } from "@/lib/server/require-admin";
import { fingerprintHlrMobile } from "@/lib/server/sozar-control-plane";
import { assertFirstRealSozarTestEnabled, getFirstRealSozarAttemptPolicy, getFirstRealSozarTestConfiguration, SozarFirstRealTestBlockedError } from "@/lib/server/sozar-first-real-gate";
import { executeFirstRealSozarTest } from "@/lib/server/sozar-first-real-executor";
import { getFirstRealSozarCandidateHints, getFirstRealSozarEligibleRecord, getFirstRealSozarSelectionContext } from "@/lib/server/sozar-first-real-selection";
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
  let policy: ReturnType<typeof getFirstRealSozarAttemptPolicy> | null = null;
  let configuration: ReturnType<typeof getFirstRealSozarTestConfiguration> | null = null;
  try {
    assertFirstRealSozarTestEnabled();
    configuration = getFirstRealSozarTestConfiguration();
    policy = getFirstRealSozarAttemptPolicy();
    configurationReady = true;
  } catch {
    configurationReady = false;
  }
  const attempts = await prisma.consultaHlr.findMany({
    where: { proveedor: "sozar" },
    orderBy: { creadoEn: "desc" },
    select: {
      id: true,
      estado: true,
      creadoEn: true,
      actualizadoEn: true,
      resultado: { select: { resultado: true, consultadoEn: true } },
      eventos: { orderBy: { creadoEn: "desc" }, take: 8, select: { tipo: true, metadatos: true, creadoEn: true } },
    },
  });
  const url = new URL(request.url);
  const baseId = url.searchParams.get("baseId");
  const sourceRowRaw = url.searchParams.get("sourceRow");
  let candidates: Awaited<ReturnType<typeof getFirstRealSozarCandidateHints>> | undefined;
  let selection: Awaited<ReturnType<typeof getFirstRealSozarSelectionContext>> | undefined;
  let selectedStatus = "SIN_PRUEBA_REAL";
  if (baseId) {
    try {
      candidates = await getFirstRealSozarCandidateHints(baseId);
      if (sourceRowRaw !== null && /^\d+$/.test(sourceRowRaw)) {
        selection = await getFirstRealSozarSelectionContext(baseId, Number(sourceRowRaw));
        if (configuration) {
          const record = await getFirstRealSozarEligibleRecord(baseId, Number(sourceRowRaw));
          const fingerprint = fingerprintHlrMobile(record.movilNormalizado, configuration.mobileFingerprintKey);
          selectedStatus = (await prisma.consultaHlr.findFirst({ where: { proveedor: "sozar", huellaMovil: fingerprint }, select: { estado: true } }))?.estado ?? selectedStatus;
        }
      }
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : "No se pudo revisar la selección de Sozar.", configurationReady }, { status: 409 });
    }
  }
  const safeAttempts = attempts.map((attempt) => ({
    attemptId: attempt.id,
    status: attempt.estado,
    createdAt: attempt.creadoEn.toISOString(),
    updatedAt: attempt.actualizadoEn.toISOString(),
    consultedAt: attempt.resultado?.consultadoEn?.toISOString() ?? null,
    shape: (attempt.resultado?.resultado as { shape?: unknown } | undefined)?.shape ?? null,
    events: attempt.eventos.map((event) => {
      const metadata = event.metadatos as Record<string, unknown>;
      return {
        type: event.tipo,
        createdAt: event.creadoEn.toISOString(),
        phase: typeof metadata.phase === "string" ? metadata.phase : null,
        code: typeof metadata.code === "string" ? metadata.code : null,
        httpStatus: typeof metadata.httpStatus === "number" ? metadata.httpStatus : null,
        resolution: typeof metadata.resolution === "string" ? metadata.resolution : null,
      };
    }),
  }));
  return Response.json({
    status: selectedStatus,
    configurationReady,
    policy: policy ? { maxAttempts: policy.maxAttempts, attemptsUsed: attempts.length, remainingAttempts: Math.max(0, policy.maxAttempts - attempts.length) } : null,
    attempts: safeAttempts,
    candidates,
    selection,
  });
}
