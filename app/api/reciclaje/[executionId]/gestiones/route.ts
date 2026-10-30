import { appendRecyclingManagements } from "@/lib/server/recycling-storage";
import { isPlainObject, readJson, uuidPattern } from "@/lib/server/request-validation";
import { requireAdminApi } from "@/lib/server/require-admin";

export async function POST(request: Request, context: { params: Promise<{ executionId: string }> }) {
  if (!await requireAdminApi()) return Response.json({ error: "No autorizado" }, { status: 401 });
  const { executionId } = await context.params;
  if (!uuidPattern.test(executionId)) return Response.json({ error: "Ejecución no válida." }, { status: 400 });
  try {
    const payload = await readJson(request);
    if (!isPlainObject(payload) || !Array.isArray(payload.rows) || payload.rows.length > 100 || !payload.rows.every((row) => isPlainObject(row) && uuidPattern.test(String(row.importId)) && Number.isInteger(row.sourceRow) && Number(row.sourceRow) >= 2 && typeof row.mobile === "string" && row.mobile.length <= 80 && (row.managedAt === null || typeof row.managedAt === "string") && (row.tipification === null || typeof row.tipification === "string") && typeof row.confirmedSale === "boolean" && (row.saleEvidence === null || typeof row.saleEvidence === "string") && typeof row.fileName === "string" && typeof row.sheetName === "string" && (row.zipName === null || typeof row.zipName === "string") && (row.internalPath === null || typeof row.internalPath === "string"))) {
      return Response.json({ error: "Gestiones CRM no válidas." }, { status: 400 });
    }
    return Response.json(await appendRecyclingManagements(executionId, payload.rows as never));
  } catch {
    return Response.json({ error: "No se pudieron guardar las gestiones CRM." }, { status: 409 });
  }
}
