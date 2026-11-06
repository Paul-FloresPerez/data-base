import { createCanonicalCrmFile } from "@/lib/server/global-crm-conciliation-storage";
import { parseCanonicalCrmFileRequest } from "@/lib/recycling/canonical-crm-request";
import { readJson } from "@/lib/server/request-validation";
import { requireAdminApi } from "@/lib/server/require-admin";

export async function POST(request: Request) {
  if (!await requireAdminApi()) return Response.json({ error: "No autorizado" }, { status: 401 });
  try {
    const payload = parseCanonicalCrmFileRequest(await readJson(request));
    if (!payload) return Response.json({ error: "Los datos del archivo CRM no son válidos." }, { status: 400 });
    return Response.json(await createCanonicalCrmFile(payload));
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "No se pudo registrar el archivo CRM." }, { status: 400 }); }
}
