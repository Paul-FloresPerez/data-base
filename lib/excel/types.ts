export type ExclusionReason =
  | "telefono_vacio"
  | "telefono_fijo"
  | "telefono_invalido"
  | "nombre_vacio"
  | "telefono_duplicado";

export const enrichedFieldOrder = [
  "operador_actual",
  "operador_origen",
  "portabilidad_desde",
  "fecha_portabilidad",
  "anio",
  "mes",
  "dia",
] as const;

export type EnrichedField = (typeof enrichedFieldOrder)[number];

export const enrichedFieldHeaders: Record<EnrichedField, string> = {
  operador_actual: "Operador Actual",
  operador_origen: "Operador Original",
  portabilidad_desde: "Portabilidad Desde",
  fecha_portabilidad: "Fecha Portabilidad",
  anio: "Año",
  mes: "Mes",
  dia: "Dia",
};

export interface ColumnMapping {
  movil: number;
  documento?: number;
  nombre?: number;
  telefono_contacto?: number;
  enriched: Partial<Record<EnrichedField, number>>;
}

export interface ImportRecord {
  sourceRow: number;
  cells: string[];
  mobile: string;
  document: string;
  name: string;
  contactPhone: string;
}

export interface ImportedDataset {
  fileName: string;
  columns: string[];
  columnMapping: ColumnMapping;
  records: ImportRecord[];
}

export interface ValidRecord extends ImportRecord {
  normalizedMobile: string;
}

export interface ExcludedRecord extends ImportRecord {
  reason: ExclusionReason;
}

export type ReasonBreakdown = Record<ExclusionReason, number>;

export interface CleaningResult {
  validRecords: ValidRecord[];
  excludedRecords: ExcludedRecord[];
  reasonBreakdown: ReasonBreakdown;
}

export interface SimulatedEnrichment {
  operador_actual: string;
  operador_origen: string;
  fecha_portabilidad: string | null;
}

export type EnrichedRecord = ValidRecord & SimulatedEnrichment;

export type EnrichmentMode = "preserve" | "overwrite";

export interface EnrichmentOutputRow {
  sourceRow: number;
  cells: string[];
}

export interface EnrichmentOutput {
  columns: string[];
  rows: EnrichmentOutputRow[];
}

export const exclusionReasonLabels: Record<ExclusionReason, string> = {
  telefono_vacio: "Teléfono vacío",
  telefono_fijo: "Teléfono fijo (8/9)",
  telefono_invalido: "Móvil inválido",
  nombre_vacio: "Nombre vacío o NULL",
  telefono_duplicado: "Número duplicado",
};
