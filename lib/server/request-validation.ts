import "server-only";

export const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function readJson(request: Request): Promise<unknown> {
  const length = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(length) && length > 900_000) throw new Error("Solicitud demasiado grande.");
  return request.json();
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function isStoredRecord(value: unknown): boolean {
  if (!isPlainObject(value) || !Number.isInteger(value.sourceRow) || Number(value.sourceRow) < 1 || !Array.isArray(value.cells) || value.cells.length > 500) return false;
  if (!value.cells.every((cell) => typeof cell === "string" && cell.length <= 20_000)) return false;
  const textFields = [value.mobile, value.document, value.name, value.contactPhone];
  if (!textFields.every((field) => typeof field === "string" && field.length <= 20_000)) return false;
  if (!["EXCEL", "CRM", "MOCK", "API_REAL"].includes(String(value.provenance))) return false;
  if (value.normalizedMobile !== null && typeof value.normalizedMobile !== "string") return false;
  if (value.reason !== null && !["telefono_vacio", "telefono_fijo", "telefono_invalido", "nombre_vacio", "telefono_duplicado"].includes(String(value.reason))) return false;
  if (!["PENDIENTE", "VALIDO", "TELEFONO_VACIO", "TELEFONO_FIJO", "TELEFONO_INVALIDO", "NOMBRE_VACIO", "TELEFONO_DUPLICADO"].includes(String(value.tipification))) return false;
  return value.enrichedCells === null || (Array.isArray(value.enrichedCells) && value.enrichedCells.every((cell) => typeof cell === "string" && cell.length <= 20_000));
}
