import { Prisma, type Campana, type EstadoExportacion } from "@/generated/prisma/client";
import { recordExport } from "@/lib/server/audit-storage";
import { prisma } from "@/lib/server/prisma";
import { isPlainObject, readJson, uuidPattern } from "@/lib/server/request-validation";
import { requireAdminApi } from "@/lib/server/require-admin";

export async function GET() {
  if (!await requireAdminApi()) return Response.json({ error: "No autorizado" }, { status: 401 });
  const exports = await prisma.registroExportacion.findMany({
    orderBy: [{ creadoEn: "desc" }, { id: "desc" }],
    take: 20,
    select: {
      id: true, creadoEn: true, campana: true, numeroLote: true, tipo: true, estado: true,
      cantidad: true, destinatario: true, base: { select: { nombreOriginal: true } },
    },
  });
  return Response.json({ exports: exports.map((entry) => ({
    id: entry.id, createdAt: entry.creadoEn.toISOString(), campaign: entry.campana,
    lotNumber: entry.numeroLote, type: entry.tipo, state: entry.estado, quantity: entry.cantidad,
    recipient: entry.destinatario, baseName: entry.base.nombreOriginal,
  })) });
}

export async function POST(request: Request) {
  const session = await requireAdminApi();
  if (!session) return Response.json({ error: "No autorizado" }, { status: 401 });
  try {
    const body = await readJson(request);
    if (!isPlainObject(body) || !uuidPattern.test(String(body.operationId)) || !uuidPattern.test(String(body.baseId)) || !["GENERADO", "DESCARGA_INICIADA"].includes(String(body.state)) || typeof body.type !== "string" || body.type.length > 80 || !Number.isInteger(body.quantity) || Number(body.quantity) < 0 || Number(body.quantity) > 10_000 || (body.campaign !== null && body.campaign !== undefined && body.campaign !== "YOIGO" && body.campaign !== "VODAFONE") || (body.lotId !== null && body.lotId !== undefined && !uuidPattern.test(String(body.lotId))) || (body.lotNumber !== null && body.lotNumber !== undefined && (!Number.isInteger(body.lotNumber) || Number(body.lotNumber) < 1)) || !isPlainObject(body.filters) || !isPlainObject(body.metadata)) return Response.json({ error: "Datos de auditoría no válidos." }, { status: 400 });
    const result = await recordExport({ operationId: String(body.operationId), userId: session.user.id, baseId: String(body.baseId), campaign: (body.campaign ?? null) as Campana | null, lotId: (body.lotId ?? null) as string | null, lotNumber: typeof body.lotNumber === "number" ? body.lotNumber : null, type: body.type, quantity: Number(body.quantity), filters: body.filters as Prisma.InputJsonValue, metadata: body.metadata as Prisma.InputJsonValue, state: body.state as EstadoExportacion });
    return Response.json({ exportId: result.id });
  } catch { return Response.json({ error: "No se pudo registrar la exportación." }, { status: 409 }); }
}
