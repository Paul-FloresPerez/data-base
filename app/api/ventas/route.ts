import { externalSalesDashboard, importExternalSales, listExternalSalesImports } from "@/lib/server/sales-storage";
import { normalizeSpanishMobile } from "@/lib/excel/cleaning";
import { isPlainObject, readJson, uuidPattern } from "@/lib/server/request-validation";
import { requireAdminApi } from "@/lib/server/require-admin";

const states = new Set(["CONFIRMADA", "AMBIGUA", "NO_CONFIRMADA"]);
const reasons = new Set(["VALIDA", "MOVIL_INVALIDO", "MOVIL_DUPLICADO"]);

function isSalesEvent(event: unknown) {
  if (!isPlainObject(event) || !Number.isInteger(event.sourceRow) || Number(event.sourceRow) < 2 || !states.has(String(event.saleStatus)) || !reasons.has(String(event.reason)) || typeof event.originalStatus !== "string" || event.originalStatus.length > 500 || ![event.soldAt, event.advisor, event.campaign].every((value) => value === null || (typeof value === "string" && value.length <= 500))) return false;
  const normalized = typeof event.mobile === "string" && normalizeSpanishMobile(event.mobile) === event.mobile;
  if (event.reason === "VALIDA") return normalized;
  if (event.reason === "MOVIL_DUPLICADO") return normalized;
  return event.mobile === null;
}

export async function GET() {
  if (!await requireAdminApi()) return Response.json({ error: "No autorizado" }, { status: 401 });
  const [imports, dashboard] = await Promise.all([listExternalSalesImports(), externalSalesDashboard()]);
  return Response.json({ imports, dashboard });
}

export async function POST(request: Request) {
  const session = await requireAdminApi();
  if (!session?.user?.id) return Response.json({ error: "No autorizado" }, { status: 401 });
  try {
    const payload = await readJson(request, 5_000_000);
    if (!isPlainObject(payload) || !uuidPattern.test(String(payload.importId)) || typeof payload.fileName !== "string" || !payload.fileName.trim() || payload.fileName.length > 180 || (payload.declaredPeriod !== null && payload.declaredPeriod !== undefined && (typeof payload.declaredPeriod !== "string" || payload.declaredPeriod.length > 180)) || typeof payload.sourceFingerprint !== "string" || payload.sourceFingerprint.length !== 64 || !Array.isArray(payload.events) || payload.events.length > 10_000 || (payload.mode !== undefined && payload.mode !== "BASICA" && payload.mode !== "AVANZADA")) {
      return Response.json({ error: "Importación de ventas no válida." }, { status: 400 });
    }
    if (!payload.events.every(isSalesEvent)) {
      return Response.json({ error: "Filas de ventas no válidas." }, { status: 400 });
    }
    const mode = payload.mode === "BASICA" ? "BASICA" : "AVANZADA";
    const events = (payload.events as Array<Record<string, unknown>>).map((event) => mode === "BASICA" && event.reason === "VALIDA"
      ? { ...event, saleStatus: "CONFIRMADA", originalStatus: "IMPORTACION_BASICA", soldAt: null, advisor: null, campaign: null }
      : event);
    const result = await importExternalSales({
      importId: String(payload.importId), userId: session.user.id, fileName: payload.fileName.trim(), declaredPeriod: typeof payload.declaredPeriod === "string" ? payload.declaredPeriod.trim() || null : null,
      sourceFingerprint: String(payload.sourceFingerprint), events: events as never,
    });
    return Response.json(result, { status: result.reused ? 200 : 201 });
  } catch {
    return Response.json({ error: "No se pudo registrar la importación de ventas." }, { status: 400 });
  }
}
