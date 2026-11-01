import { previewRecyclingConciliation } from "@/lib/server/recycling-storage";
import { isPlainObject, readJson, uuidPattern } from "@/lib/server/request-validation";
import { requireAdminApi } from "@/lib/server/require-admin";

export async function POST(request: Request, context: { params: Promise<{ executionId: string }> }) {
  const session = await requireAdminApi();
  if (!session?.user?.id) return Response.json({ error: "No autorizado" }, { status: 401 });
  const { executionId } = await context.params;
  if (!uuidPattern.test(executionId)) return Response.json({ error: "Ejecución no válida." }, { status: 400 });
  try {
    const payload = await readJson(request);
    if (!isPlainObject(payload) || !Array.isArray(payload.rows) || payload.rows.length > 10_000 || !payload.rows.every((row) => isPlainObject(row) && uuidPattern.test(String(row.fileId)) && typeof row.fileName === "string" && row.fileName.trim().length > 0 && row.fileName.length <= 180 && Number.isInteger(row.sourceRow) && Number(row.sourceRow) >= 2 && typeof row.mobile === "string" && row.mobile.length <= 80)) {
      return Response.json({ error: "Datos de conciliación no válidos." }, { status: 400 });
    }
    return Response.json({ conciliation: await previewRecyclingConciliation({ executionId, userId: session.user.id, rows: payload.rows.map((row) => ({ fileId: String(row.fileId), fileName: String(row.fileName).trim(), sourceRow: Number(row.sourceRow), mobile: String(row.mobile) })) }) });
  } catch {
    return Response.json({ error: "No se pudo conciliar los archivos CRM." }, { status: 409 });
  }
}
