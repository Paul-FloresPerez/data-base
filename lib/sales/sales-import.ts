import { normalizeSpanishMobile, spanishMobileExclusionReason } from "../excel/cleaning.ts";

export type SalesColumnMapping = {
  mobile: number;
  soldAt?: number;
  status?: number;
  advisor?: number;
  campaign?: number;
};

export type SalesImportRow = {
  sourceRow: number;
  cells: string[];
};

export type SalesEventPreview = {
  sourceRow: number;
  mobile: string | null;
  saleStatus: "CONFIRMADA" | "AMBIGUA" | "NO_CONFIRMADA";
  originalStatus: string;
  reason: "VALIDA" | "MOVIL_INVALIDO" | "MOVIL_DUPLICADO";
  soldAt: string | null;
  advisor: string | null;
  campaign: string | null;
};

const aliases = {
  mobile: ["movil", "movilcliente", "telefonocelular", "telefono", "numero", "numeroemitido", "nemitido", "nums"],
  soldAt: ["fechaventa", "fecha", "fechaalta", "fechacontratacion"],
  status: ["estadoventa", "estado", "venta", "resultado", "situacion"],
  advisor: ["asesor", "asesorcomercial", "agente", "vendedor"],
  campaign: ["campana", "campaña", "producto"],
} as const;

function comparable(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es-ES").replace(/[^a-z0-9]/g, "");
}

function headerIndex(headers: readonly string[], candidates: readonly string[]) {
  return headers.findIndex((header) => candidates.includes(comparable(header)));
}

export function suggestSalesColumnMapping(headers: readonly string[]): Partial<SalesColumnMapping> {
  const mobile = headerIndex(headers, aliases.mobile);
  const soldAt = headerIndex(headers, aliases.soldAt);
  const status = headerIndex(headers, aliases.status);
  const advisor = headerIndex(headers, aliases.advisor);
  const campaign = headerIndex(headers, aliases.campaign);
  return {
    ...(mobile >= 0 ? { mobile } : {}),
    ...(soldAt >= 0 ? { soldAt } : {}),
    ...(status >= 0 ? { status } : {}),
    ...(advisor >= 0 ? { advisor } : {}),
    ...(campaign >= 0 ? { campaign } : {}),
  };
}

export function classifySaleStatus(value: string): SalesEventPreview["saleStatus"] {
  const normalized = comparable(value);
  if (/^(si|confirmada|confirmado|cerrada|cerrado|vendida|vendido|venta)$/.test(normalized)) return "CONFIRMADA";
  if (!normalized || /pend|revis|ambig|consulta|porconfirm/.test(normalized)) return "AMBIGUA";
  return "NO_CONFIRMADA";
}

function safeText(value: string | undefined) {
  const trimmed = value?.trim() ?? "";
  return trimmed ? trimmed.slice(0, 500) : null;
}

export function previewSalesImport(rows: readonly SalesImportRow[], mapping: SalesColumnMapping) {
  const seen = new Set<string>();
  const events: SalesEventPreview[] = [];
  for (const row of rows) {
    const rawMobile = row.cells[mapping.mobile] ?? "";
    const normalized = normalizeSpanishMobile(rawMobile);
    const invalid = spanishMobileExclusionReason(rawMobile);
    const duplicated = normalized ? seen.has(normalized) : false;
    if (normalized) seen.add(normalized);
    const statusText = row.cells[mapping.status ?? -1] ?? "";
    events.push({
      sourceRow: row.sourceRow,
      mobile: normalized,
      saleStatus: classifySaleStatus(statusText),
      originalStatus: safeText(statusText) ?? "",
      reason: invalid ? "MOVIL_INVALIDO" : duplicated ? "MOVIL_DUPLICADO" : "VALIDA",
      soldAt: safeText(row.cells[mapping.soldAt ?? -1]),
      advisor: safeText(row.cells[mapping.advisor ?? -1]),
      campaign: safeText(row.cells[mapping.campaign ?? -1]),
    });
  }
  const valid = events.filter((event) => event.reason === "VALIDA");
  return {
    events,
    summary: {
      totalRows: events.length,
      validUnique: valid.length,
      invalid: events.filter((event) => event.reason === "MOVIL_INVALIDO").length,
      duplicates: events.filter((event) => event.reason === "MOVIL_DUPLICADO").length,
      confirmed: valid.filter((event) => event.saleStatus === "CONFIRMADA").length,
      ambiguous: valid.filter((event) => event.saleStatus === "AMBIGUA").length,
    },
  };
}
