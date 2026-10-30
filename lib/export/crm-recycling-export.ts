import { datePartsFromPortability } from "../excel/portability-date.ts";
import type { EnrichmentOutput, EnrichmentOutputRow } from "../excel/types.ts";

/** Exact, agreed CRM import contract. It is intentionally independent of CRM typification headers. */
export const CRM_RECYCLING_HEADERS = [
  "Teléfono Movil",
  "Teléfono Contacto",
  "Tipificación",
  "Operador Actual",
  "Operador Original",
  "Portabilidad Desde",
  "Fecha Portabilidad",
  "Año",
  "Mes",
  "Dia",
  "Numero Doc",
  "Nombres",
  "Apellido paterno",
  "Apellido materno",
  "Nombre de calle",
  "Numero",
  "Escalera",
  "Portal",
  "Planta",
  "Puerta",
  "Código Postal",
  "Provincia",
  "Localidad",
  "Correo",
] as const;

type CrmHeader = (typeof CRM_RECYCLING_HEADERS)[number];

const aliases: Record<CrmHeader, readonly string[]> = {
  "Teléfono Movil": ["telefonomovil", "telefonosmovil", "movil", "celular", "nums", "numeroemitido"],
  "Teléfono Contacto": ["telefonocontacto", "telefonofijo", "telefono"],
  "Tipificación": ["tipificacion", "tipificacionfinal"],
  "Operador Actual": ["operadoractual"],
  "Operador Original": ["operadororiginal", "operadororigen"],
  "Portabilidad Desde": ["portabilidaddesde", "operadordonante"],
  "Fecha Portabilidad": ["fechaportabilidad"],
  "Año": ["ano"],
  "Mes": ["mes"],
  "Dia": ["dia"],
  "Numero Doc": ["numerodoc", "documento", "dni", "nie"],
  "Nombres": ["nombres", "nombre"],
  "Apellido paterno": ["apellidopaterno", "primerapellido"],
  "Apellido materno": ["apellidomaterno", "segundoapellido"],
  "Nombre de calle": ["nombredecalle", "calle", "direccion"],
  "Numero": ["numero", "numerocalle"],
  "Escalera": ["escalera"],
  "Portal": ["portal"],
  "Planta": ["planta", "piso"],
  "Puerta": ["puerta"],
  "Código Postal": ["codigopostal", "cp"],
  "Provincia": ["provincia"],
  "Localidad": ["localidad", "municipio", "ciudad"],
  "Correo": ["correo", "email", "correoelectronico"],
};

function normalizeHeader(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es-ES")
    .replace(/[^a-z0-9]/g, "");
}

function sourceIndexes(columns: readonly string[]) {
  const byName = new Map<string, number>();
  for (const [index, column] of columns.entries()) {
    const normalized = normalizeHeader(column);
    if (!byName.has(normalized)) byName.set(normalized, index);
  }
  return Object.fromEntries(CRM_RECYCLING_HEADERS.map((header) => [header, aliases[header].map((alias) => byName.get(alias)).find((index): index is number => index !== undefined)])) as Record<CrmHeader, number | undefined>;
}

function value(row: EnrichmentOutputRow, index: number | undefined): string {
  return index === undefined ? "" : String(row.cells[index] ?? "");
}

export function isCrmRecyclingContract(columns: readonly string[]): boolean {
  return columns.length === CRM_RECYCLING_HEADERS.length && columns.every((column, index) => column === CRM_RECYCLING_HEADERS[index]);
}

export function assertCrmRecyclingContract(output: EnrichmentOutput): void {
  if (!isCrmRecyclingContract(output.columns)) throw new Error("La estructura de exportación CRM no coincide con los 24 encabezados acordados.");
  if (output.rows.some((row) => row.cells.length !== CRM_RECYCLING_HEADERS.length)) throw new Error("Una fila CRM no conserva las 24 columnas obligatorias.");
}

/**
 * Projects an eligible recycled base into the CRM contract. All values remain
 * text to protect identifiers such as telephones, documents and postal codes.
 */
export function buildCrmRecyclingOutput(output: EnrichmentOutput): EnrichmentOutput {
  const indexes = sourceIndexes(output.columns);
  const rows = output.rows.map((row) => {
    const date = value(row, indexes["Fecha Portabilidad"]);
    const parts = datePartsFromPortability(date);
    return {
      sourceRow: row.sourceRow,
      cells: CRM_RECYCLING_HEADERS.map((header) => {
        // Preserve the source value verbatim; date parts are derived without
        // any time-zone conversion or mutation of the original cell.
        if (header === "Fecha Portabilidad") return date;
        if (header === "Año") return parts.anio || value(row, indexes[header]);
        if (header === "Mes") return parts.mes || value(row, indexes[header]);
        if (header === "Dia") return parts.dia || value(row, indexes[header]);
        return value(row, indexes[header]);
      }),
    };
  });
  const projected = { columns: [...CRM_RECYCLING_HEADERS], rows };
  assertCrmRecyclingContract(projected);
  return projected;
}
