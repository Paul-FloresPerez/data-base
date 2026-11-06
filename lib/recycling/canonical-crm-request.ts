export type CanonicalCrmFileRequest = {
  importacionId: string;
  huellaContenido: string;
  nombreArchivo: string;
  headers: string[];
  procedencia: { zipName: string | null; internalPath: string | null } | null;
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fingerprintPattern = /^[a-f0-9]{32,128}$/i;

function plainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function optionalSourceText(value: unknown, maximumLength: number): string | null | undefined {
  if (value === undefined || value === null) return value;
  return typeof value === "string" && value.length <= maximumLength ? value : undefined;
}

/**
 * Validates the browser boundary for a canonical CRM source. Direct XLSX/CSV
 * sources have no ZIP provenance, represented explicitly as null rather than
 * as an invalid empty source.
 */
export function parseCanonicalCrmFileRequest(value: unknown): CanonicalCrmFileRequest | null {
  if (!plainObject(value)) return null;
  const importacionId = typeof value.importacionId === "string" ? value.importacionId : "";
  const huellaContenido = typeof value.huellaContenido === "string" ? value.huellaContenido : "";
  const nombreArchivo = typeof value.nombreArchivo === "string" ? value.nombreArchivo.trim() : "";
  if (!uuidPattern.test(importacionId) || !fingerprintPattern.test(huellaContenido) || !nombreArchivo || nombreArchivo.length > 180 || !Array.isArray(value.headers) || !value.headers.length || value.headers.length > 500 || !value.headers.every((header) => typeof header === "string" && header.length <= 500)) return null;

  if (value.procedencia === undefined || value.procedencia === null) {
    return { importacionId, huellaContenido, nombreArchivo, headers: value.headers, procedencia: null };
  }
  if (!plainObject(value.procedencia)) return null;
  const zipName = optionalSourceText(value.procedencia.zipName, 180);
  const internalPath = optionalSourceText(value.procedencia.internalPath, 500);
  if (zipName === undefined || internalPath === undefined) return null;
  return { importacionId, huellaContenido, nombreArchivo, headers: value.headers, procedencia: { zipName, internalPath } };
}
