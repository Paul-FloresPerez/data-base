import { createCanonicalCrmFile } from "@/lib/server/global-crm-conciliation-storage";
import { isPlainObject, readJson, uuidPattern } from "@/lib/server/request-validation";
import { requireAdminApi } from "@/lib/server/require-admin";

export async function POST(request: Request) {
  if (!await requireAdminApi()) return Response.json({ error: "No autorizado" }, { status: 401 });
  try {
    const payload = await readJson(request);
    if (!isPlainObject(payload) || !uuidPattern.test(String(payload.importacionId)) || typeof payload.huellaContenido !== "string" || !/^[a-f0-9]{32,128}$/i.test(payload.huellaContenido) || typeof payload.nombreArchivo !== "string" || !payload.nombreArchivo.trim() || payload.nombreArchivo.length > 180 || !Array.isArray(payload.headers) || !payload.headers.length || payload.headers.length > 500 || !payload.headers.every((value) => typeof value === "string" && value.length <= 500)) return Response.json({ error: "Archivo CRM no válido." }, { status: 400 });
    return Response.json(await createCanonicalCrmFile({ importacionId: String(payload.importacionId), huellaContenido: payload.huellaContenido, nombreArchivo: payload.nombreArchivo.trim(), headers: payload.headers }));
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "No se pudo registrar el archivo CRM." }, { status: 400 }); }
}
