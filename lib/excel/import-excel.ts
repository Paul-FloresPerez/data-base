import type { WorkBook } from "xlsx";

import {
  enrichedFieldOrder,
  type ColumnMapping,
  type EnrichedField,
  type ImportedDataset,
} from "./types.ts";

const inputFieldAliases = {
  movil: ["telefonomovil", "movil", "celular"],
  documento: ["numerodoc", "documento", "dni", "nie"],
  nombre: ["nombres", "nombre"],
  telefono_contacto: ["telefonocontacto"],
} as const;

type InputField = keyof typeof inputFieldAliases;

const enrichedFieldAliases: Record<EnrichedField, readonly string[]> = {
  operador_actual: ["operadoractual"],
  operador_origen: ["operadororiginal"],
  portabilidad_desde: ["portabilidaddesde"],
  fecha_portabilidad: ["fechaportabilidad"],
  anio: ["ano"],
  mes: ["mes"],
  dia: ["dia"],
};

const inputAliasMap = new Map<string, InputField>(
  Object.entries(inputFieldAliases).flatMap(([field, aliases]) =>
    aliases.map((alias) => [alias, field as InputField] as const),
  ),
);

const enrichedAliasMap = new Map<string, EnrichedField>(
  enrichedFieldOrder.flatMap((field) =>
    enrichedFieldAliases[field].map((alias) => [alias, field] as const),
  ),
);

export class ExcelImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExcelImportError";
  }
}

function asCellText(value: unknown): string {
  return value === null || value === undefined ? "" : String(value);
}

export function normalizeColumnName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es-ES")
    .replace(/[^a-z0-9]/g, "");
}

function findColumnMapping(headers: string[]): ColumnMapping {
  const mapping: Partial<Record<InputField, number>> = {};
  const enriched: Partial<Record<EnrichedField, number>> = {};

  for (const [index, header] of headers.entries()) {
    const normalizedHeader = normalizeColumnName(header);
    const inputField = inputAliasMap.get(normalizedHeader);
    const enrichedField = enrichedAliasMap.get(normalizedHeader);

    if (inputField && mapping[inputField] === undefined) {
      mapping[inputField] = index;
    }

    if (enrichedField && enriched[enrichedField] === undefined) {
      enriched[enrichedField] = index;
    }
  }

  if (mapping.movil === undefined) {
    throw new ExcelImportError(
      "Falta la columna obligatoria “Teléfono Movil”. También se aceptan “Móvil” o “Celular”.",
    );
  }

  return {
    movil: mapping.movil,
    documento: mapping.documento,
    nombre: mapping.nombre,
    telefono_contacto: mapping.telefono_contacto,
    enriched,
  };
}

export function datasetFromWorkbook(
  workbook: WorkBook,
  xlsx: typeof import("xlsx"),
  fileName: string,
): ImportedDataset {
  const firstSheetName = workbook.SheetNames[0];

  if (!firstSheetName) {
    throw new ExcelImportError("El archivo no contiene hojas para importar.");
  }

  const worksheet = workbook.Sheets[firstSheetName];

  if (!worksheet) {
    throw new ExcelImportError("No se pudo leer la primera hoja del archivo.");
  }

  const sheetRows = xlsx.utils.sheet_to_json<unknown[]>(worksheet, {
    header: 1,
    defval: "",
    raw: false,
    blankrows: true,
  });
  const headers = (sheetRows[0] ?? []).map(asCellText);

  if (headers.length === 0 || headers.every((header) => header.trim().length === 0)) {
    throw new ExcelImportError("La primera fila debe contener los encabezados de las columnas.");
  }

  const columnMapping = findColumnMapping(headers);

  return {
    fileName,
    columns: headers,
    columnMapping,
    records: sheetRows.slice(1).map((row, index) => ({
      sourceRow: index + 2,
      cells: headers.map((_, columnIndex) => asCellText(row[columnIndex])),
      mobile: asCellText(row[columnMapping.movil]),
      document:
        columnMapping.documento === undefined ? "" : asCellText(row[columnMapping.documento]),
      name: columnMapping.nombre === undefined ? "" : asCellText(row[columnMapping.nombre]),
      contactPhone:
        columnMapping.telefono_contacto === undefined
          ? ""
          : asCellText(row[columnMapping.telefono_contacto]),
    })),
  };
}

export async function importExcelFile(file: File): Promise<ImportedDataset> {
  if (!file.name.toLocaleLowerCase("es-ES").endsWith(".xlsx")) {
    throw new ExcelImportError("Selecciona un archivo Excel con extensión .xlsx.");
  }

  try {
    const [xlsx, buffer] = await Promise.all([import("xlsx"), file.arrayBuffer()]);
    const workbook = xlsx.read(buffer, { type: "array" });

    return datasetFromWorkbook(workbook, xlsx, file.name);
  } catch (error) {
    if (error instanceof ExcelImportError) {
      throw error;
    }

    throw new ExcelImportError("No se pudo leer el Excel. Comprueba que el archivo no esté dañado.");
  }
}
