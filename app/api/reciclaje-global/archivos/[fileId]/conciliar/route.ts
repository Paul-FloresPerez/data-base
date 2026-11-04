import { conciliateCanonicalCrmFile, previewGlobalCrmConciliation } from "@/lib/server/global-crm-conciliation-storage";
import { uuidPattern } from "@/lib/server/request-validation";
import { requireAdminApi } from "@/lib/server/require-admin";

export async function POST(_: Request, context: { params: Promise<{ fileId: string }> }) {
  if (!await requireAdminApi()) return Response.json({ error: "No autorizado" }, { status: 401 });
  const { fileId } = await context.params;
  if (!uuidPattern.test(fileId)) return Response.json({ error: "Archivo CRM no válido." }, { status: 400 });
  try {
    const [summary, firstPage] = await Promise.all([conciliateCanonicalCrmFile({ archivoCrmId: fileId }), previewGlobalCrmConciliation({ archivoCrmId: fileId, pageSize: 100 })]);
    return Response.json({ summary, preview: firstPage });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "No se pudo conciliar el archivo CRM." }, { status: 400 }); }
}
