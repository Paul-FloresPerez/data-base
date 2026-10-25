import type { AccionAuditoria, Campana } from "@/generated/prisma/client";
import { listAudit } from "@/lib/server/audit-storage";
import { uuidPattern } from "@/lib/server/request-validation";
import { requireAdminApi } from "@/lib/server/require-admin";

const actions = new Set(["BASE_CREADA", "BASE_RECICLADA", "ENRIQUECIMIENTO_APLICADO", "CONFIGURACION_CAMPANA", "LOTES_CREADOS", "EXPORTACION_GENERADA", "DESCARGA_INICIADA", "ENTREGA_CONFIRMADA"]);

export async function GET(request: Request) {
  if (!await requireAdminApi()) return Response.json({ error: "No autorizado" }, { status: 401 });
  const search = new URL(request.url).searchParams;
  const baseId = search.get("baseId") ?? undefined;
  const campaign = search.get("campaign");
  const action = search.get("action");
  const from = search.get("from");
  const to = search.get("to");
  const take = Math.min(50, Math.max(1, Number(search.get("take") ?? 20)));
  if ((baseId && !uuidPattern.test(baseId)) || (campaign && campaign !== "YOIGO" && campaign !== "VODAFONE") || (action && !actions.has(action))) return Response.json({ error: "Filtros no válidos." }, { status: 400 });
  const parseDate = (value: string | null) => value && !Number.isNaN(Date.parse(value)) ? new Date(value) : undefined;
  return Response.json(await listAudit({ baseId, campaign: campaign as Campana | undefined, action: action as AccionAuditoria | undefined, from: parseDate(from), to: parseDate(to), cursor: search.get("cursor") ?? undefined, take }));
}
