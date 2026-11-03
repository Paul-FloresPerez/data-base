import { normalizeSpanishMobile } from "@/lib/excel/cleaning";
import { confirmedExternalSales } from "@/lib/server/sales-storage";
import { isPlainObject, readJson } from "@/lib/server/request-validation";
import { requireAdminApi } from "@/lib/server/require-admin";

/** Read-only server check: the browser never decides whether a mobile is blocked. */
export async function POST(request: Request) {
  if (!await requireAdminApi()) return Response.json({ error: "No autorizado" }, { status: 401 });
  try {
    const payload = await readJson(request, 500_000);
    if (!isPlainObject(payload) || !Array.isArray(payload.mobiles) || payload.mobiles.length > 10_000 || !payload.mobiles.every((mobile) => typeof mobile === "string" && normalizeSpanishMobile(mobile) === mobile)) {
      return Response.json({ error: "Móviles de previsualización no válidos." }, { status: 400 });
    }
    const unique = [...new Set(payload.mobiles as string[])];
    const blocked = await confirmedExternalSales(unique);
    return Response.json({ previouslyBlocked: blocked.size });
  } catch {
    return Response.json({ error: "No se pudo previsualizar el bloqueo comercial." }, { status: 400 });
  }
}
