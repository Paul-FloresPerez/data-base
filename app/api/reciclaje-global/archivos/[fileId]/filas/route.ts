import { appendCanonicalCrmRows } from "@/lib/server/global-crm-conciliation-storage";
import { isPlainObject, readJson, uuidPattern } from "@/lib/server/request-validation";
import { requireAdminApi } from "@/lib/server/require-admin";

export async function POST(request: Request, context: { params: Promise<{ fileId: string }> }) {
  if (!await requireAdminApi()) return Response.json({ error: "No autorizado" }, { status: 401 });
  const { fileId } = await context.params;
  if (!uuidPattern.test(fileId)) return Response.json({ error: "Archivo CRM no válido." }, { status: 400 });
  try {
    const payload = await readJson(request);
    if (!isPlainObject(payload) || !Array.isArray(payload.rows) || !payload.rows.length || payload.rows.length > 250 || !payload.rows.every((row) => isPlainObject(row) && typeof row.hoja === "string" && row.hoja.length > 0 && row.hoja.length <= 180 && Number.isInteger(row.fila) && Number(row.fila) >= 2 && typeof row.movil === "string" && row.movil.length <= 80 && (row.fechaGestion === null || typeof row.fechaGestion === "string") && (row.tipificacion === null || typeof row.tipificacion === "string") && typeof row.ventaConfirmada === "boolean" && (row.evidenciaVenta === null || typeof row.evidenciaVenta === "string") && Array.isArray(row.cells) && row.cells.length <= 500 && row.cells.every((value) => typeof value === "string" && value.length <= 20_000))) return Response.json({ error: "Filas CRM no válidas." }, { status: 400 });
    return Response.json(await appendCanonicalCrmRows({ archivoCrmId: fileId, rows: payload.rows.map((row) => ({ hoja: String(row.hoja), fila: Number(row.fila), movil: String(row.movil), fechaGestion: row.fechaGestion === null ? null : String(row.fechaGestion), tipificacion: row.tipificacion === null ? null : String(row.tipificacion), ventaConfirmada: Boolean(row.ventaConfirmada), evidenciaVenta: row.evidenciaVenta === null ? null : String(row.evidenciaVenta), cells: row.cells.map(String) })) }));
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "No se pudieron guardar las filas CRM." }, { status: 400 }); }
}
