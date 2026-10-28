import { parsePortabilityDateParts } from "../excel/portability-date.ts";

export const campaignOperators = ["yoigo", "vodafone"] as const;

export type CampaignOperatorId = (typeof campaignOperators)[number];

type KnownOperatorId = CampaignOperatorId | "movistar" | "orange" | "pepephone" | "euskaltel" | "r_cable";

export interface CampaignOperatorDefinition {
  id: CampaignOperatorId;
  label: string;
}
interface KnownOperatorDefinition {
  id: KnownOperatorId;
  aliases: readonly string[];
  label: string;
}

export const campaignOperatorDefinitions: readonly CampaignOperatorDefinition[] = [
  { id: "yoigo", label: "Yoigo" },
  { id: "vodafone", label: "Vodafone" },
];

const knownOperatorDefinitions: readonly KnownOperatorDefinition[] = [
  { id: "movistar", label: "Movistar", aliases: ["movistar", "movistar espana"] },
  { id: "orange", label: "Orange", aliases: ["orange", "orange espana"] },
  { id: "vodafone", label: "Vodafone", aliases: ["vodafone", "vodafone espana"] },
  { id: "yoigo", label: "Yoigo", aliases: ["yoigo", "yoigo espana"] },
  { id: "pepephone", label: "Pepephone", aliases: ["pepephone"] },
  { id: "euskaltel", label: "Euskaltel", aliases: ["euskaltel"] },
  { id: "r_cable", label: "R_CABLE", aliases: ["r_cable", "rcable"] },
];

const operatorAliasMap = new Map<string, KnownOperatorId>(
  knownOperatorDefinitions.flatMap((operator) =>
    operator.aliases.map((alias) => [normalizeComparableValue(alias), operator.id] as const),
  ),
);

const operatorLabelMap = new Map<KnownOperatorId, string>(
  knownOperatorDefinitions.map((operator) => [operator.id, operator.label] as const),
);

const geographicHeaderAliases = {
  provincia: ["provincia"],
  localidad: ["localidad", "municipio", "ciudad"],
  codigo_postal: ["codigopostal", "cp"],
} as const;

const portabilityHeaderAliases = ["fechaportabilidad"];
const permanenceHeaderAliases = ["permanencia", "estadopermanencia", "permanenciacontractual"];

export interface CampaignInputRow {
  sourceRow: number;
  cells: string[];
}

export interface CampaignInput {
  columns: readonly string[];
  rows: readonly CampaignInputRow[];
}

export interface GeographicFilters {
  codigo_postal?: string;
  localidad?: string;
  provincia?: string;
}

export interface CampaignFilters extends GeographicFilters {
  asOfDate?: Date;
  includeWithoutPortabilityDate?: boolean;
  minimumPortabilityMonths?: number;
  currentOperatorValues?: readonly string[];
}

export interface CampaignColumnMapping {
  codigo_postal?: number;
  fecha_portabilidad?: number;
  localidad?: number;
  operador_actual?: number;
  permanencia?: number;
  provincia?: number;
}

export type CampaignFilterReason =
  | "operador_actual"
  | "geografia"
  | "antiguedad_portabilidad"
  | "fecha_portabilidad_ausente";

export const campaignFilterReasonLabels: Record<CampaignFilterReason, string> = {
  operador_actual: "Operador actual",
  geografia: "Ubicación",
  antiguedad_portabilidad: "Antigüedad mínima",
  fecha_portabilidad_ausente: "Sin fecha de portabilidad",
};

export interface CampaignFilterSummary {
  excludedRecords: CampaignInputRow[];
  reasonBreakdown: Record<CampaignFilterReason, number>;
  totalRecords: number;
}

export interface DetectedCurrentOperator {
  label: string;
  value: string;
}

export interface CampaignBreakdown {
  eligible: CampaignInputRow[];
  excludedByOperator: CampaignInputRow[];
  operator: CampaignOperatorDefinition;
  totalCleanRecords: number;
  unclassified: CampaignInputRow[];
}

export interface CampaignReport {
  columnMapping: CampaignColumnMapping;
  columns: readonly string[];
  currentOperatorOptions: DetectedCurrentOperator[];
  campaigns: CampaignBreakdown[];
  filteredRecords: CampaignInputRow[];
  filterSummary: CampaignFilterSummary;
}

export function normalizeComparableValue(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es-ES")
    .replace(/[^a-z0-9]/g, "");
}

export function normalizeOperator(value: string): KnownOperatorId | null {
  return operatorAliasMap.get(normalizeComparableValue(value)) ?? null;
}

export function findCampaignColumns(columns: readonly string[]): CampaignColumnMapping {
  const mapping: CampaignColumnMapping = {};

  for (const [index, header] of columns.entries()) {
    const normalizedHeader = normalizeComparableValue(header);

    if (normalizedHeader === "operadoractual" && mapping.operador_actual === undefined) {
      mapping.operador_actual = index;
    }

    if (portabilityHeaderAliases.includes(normalizedHeader) && mapping.fecha_portabilidad === undefined) {
      mapping.fecha_portabilidad = index;
    }

    if (permanenceHeaderAliases.includes(normalizedHeader) && mapping.permanencia === undefined) {
      mapping.permanencia = index;
    }

    for (const [field, aliases] of Object.entries(geographicHeaderAliases) as [
      keyof typeof geographicHeaderAliases,
      readonly string[],
    ][]) {
      if (aliases.includes(normalizedHeader) && mapping[field] === undefined) {
        mapping[field] = index;
      }
    }
  }

  return mapping;
}

export function parsePortabilityDate(value: string): Date | null {
  const parts = parsePortabilityDateParts(value);
  return parts ? new Date(Number(parts.anio), Number(parts.mes) - 1, Number(parts.dia)) : null;
}

export function completedMonthsSincePortability(value: string, asOfDate = new Date()): number | null {
  const portabilityDate = parsePortabilityDate(value);

  if (!portabilityDate) {
    return null;
  }

  let months =
    (asOfDate.getFullYear() - portabilityDate.getFullYear()) * 12 +
    (asOfDate.getMonth() - portabilityDate.getMonth());

  if (asOfDate.getDate() < portabilityDate.getDate()) {
    months -= 1;
  }

  return Math.max(0, months);
}

export function currentOperatorFilterValue(value: string): string | null {
  const normalized = normalizeComparableValue(value);

  if (!normalized) {
    return null;
  }

  const knownOperator = normalizeOperator(value);
  return knownOperator ? `known:${knownOperator}` : `detected:${normalized}`;
}

export function getDetectedCurrentOperators(
  input: CampaignInput,
  mapping = findCampaignColumns(input.columns),
): DetectedCurrentOperator[] {
  if (mapping.operador_actual === undefined) {
    return [];
  }

  const options = new Map<string, DetectedCurrentOperator>();

  for (const row of uniqueRows(input.rows)) {
    const rawValue = row.cells[mapping.operador_actual] ?? "";
    const value = currentOperatorFilterValue(rawValue);

    if (!value || options.has(value)) {
      continue;
    }

    const knownOperator = normalizeOperator(rawValue);
    options.set(value, {
      value,
      label: knownOperator ? (operatorLabelMap.get(knownOperator) ?? rawValue.trim()) : rawValue.trim(),
    });
  }

  return [...options.values()];
}

export function permanenceStatus(row: CampaignInputRow, mapping: CampaignColumnMapping): string {
  if (mapping.permanencia === undefined) {
    return "No verificado";
  }

  return row.cells[mapping.permanencia]?.trim() || "No verificado";
}

function uniqueRows(rows: readonly CampaignInputRow[]): CampaignInputRow[] {
  const seenSourceRows = new Set<number>();
  const unique: CampaignInputRow[] = [];

  for (const row of rows) {
    if (!seenSourceRows.has(row.sourceRow)) {
      seenSourceRows.add(row.sourceRow);
      unique.push(row);
    }
  }

  return unique;
}

function matchesGeographicFilters(
  row: CampaignInputRow,
  mapping: CampaignColumnMapping,
  filters: GeographicFilters,
): boolean {
  const filterEntries: [keyof GeographicFilters, string | undefined][] = [
    ["provincia", filters.provincia],
    ["localidad", filters.localidad],
    ["codigo_postal", filters.codigo_postal],
  ];

  for (const [field, requestedValue] of filterEntries) {
    const columnIndex = mapping[field];

    if (requestedValue?.trim() && columnIndex !== undefined) {
      const rowValue = row.cells[columnIndex] ?? "";
      const normalize = field === "codigo_postal" ? (value: string) => value.trim() : normalizeComparableValue;

      if (normalize(rowValue) !== normalize(requestedValue)) {
        return false;
      }
    }
  }

  return true;
}

function filterReasonsForRow(
  row: CampaignInputRow,
  mapping: CampaignColumnMapping,
  filters: CampaignFilters,
): CampaignFilterReason[] {
  const reasons: CampaignFilterReason[] = [];
  const selectedCurrentOperators = filters.currentOperatorValues ?? [];

  if (selectedCurrentOperators.length > 0) {
    const operatorValue = mapping.operador_actual === undefined ? null : currentOperatorFilterValue(row.cells[mapping.operador_actual] ?? "");
    if (!operatorValue || !selectedCurrentOperators.includes(operatorValue)) {
      reasons.push("operador_actual");
    }
  }

  if (!matchesGeographicFilters(row, mapping, filters)) {
    reasons.push("geografia");
  }

  const portabilityValue = mapping.fecha_portabilidad === undefined ? "" : (row.cells[mapping.fecha_portabilidad] ?? "");
  const months = completedMonthsSincePortability(portabilityValue, filters.asOfDate);
  const hasMinimumAge = Number.isFinite(filters.minimumPortabilityMonths) && (filters.minimumPortabilityMonths ?? 0) >= 0;

  if (months === null) {
    if (filters.includeWithoutPortabilityDate === false) {
      reasons.push("fecha_portabilidad_ausente");
    }
  } else if (hasMinimumAge && months < (filters.minimumPortabilityMonths ?? 0)) {
    reasons.push("antiguedad_portabilidad");
  }

  return reasons;
}

export function buildCampaignReport(
  input: CampaignInput,
  selectedOperators: readonly CampaignOperatorId[],
  filters: CampaignFilters = {},
): CampaignReport {
  const columnMapping = findCampaignColumns(input.columns);
  const selectedOperatorSet = new Set(selectedOperators);
  const selectedDefinitions = campaignOperatorDefinitions.filter((operator) => selectedOperatorSet.has(operator.id));
  const sourceRecords = uniqueRows(input.rows);
  const reasonBreakdown: Record<CampaignFilterReason, number> = {
    operador_actual: 0,
    geografia: 0,
    antiguedad_portabilidad: 0,
    fecha_portabilidad_ausente: 0,
  };
  const filteredRecords: CampaignInputRow[] = [];
  const excludedRecords: CampaignInputRow[] = [];

  for (const row of sourceRecords) {
    const reasons = filterReasonsForRow(row, columnMapping, filters);

    if (reasons.length === 0) {
      filteredRecords.push(row);
      continue;
    }

    excludedRecords.push(row);
    for (const reason of reasons) {
      reasonBreakdown[reason] += 1;
    }
  }

  const campaigns = selectedDefinitions.map((campaign) => {
    const eligible: CampaignInputRow[] = [];
    const excludedByOperator: CampaignInputRow[] = [];
    const unclassified: CampaignInputRow[] = [];

    for (const row of filteredRecords) {
      const operatorValue =
        columnMapping.operador_actual === undefined
          ? ""
          : (row.cells[columnMapping.operador_actual] ?? "");
      const operator = normalizeOperator(operatorValue);

      if (operator === null) {
        unclassified.push(row);
      } else if (operator === campaign.id) {
        excludedByOperator.push(row);
      } else {
        eligible.push(row);
      }
    }

    return {
      operator: campaign,
      totalCleanRecords: filteredRecords.length,
      eligible,
      excludedByOperator,
      unclassified,
    };
  });

  return {
    columns: input.columns,
    columnMapping,
    currentOperatorOptions: getDetectedCurrentOperators(input, columnMapping),
    campaigns,
    filteredRecords,
    filterSummary: {
      excludedRecords,
      reasonBreakdown,
      totalRecords: sourceRecords.length,
    },
  };
}
