import { normalizeSpanishMobile, spanishMobileExclusionReason } from "../excel/cleaning.ts";

export type SalesColumnMapping = {
  mobile: number;
  soldAt?: number;
  status?: number;
  advisor?: number;
  campaign?: number;
};

export type SalesImportMode = "BASICA" | "AVANZADA";

export type SalesMobileColumnDetection = {
  candidates: number[];
  selected: number | undefined;
  ambiguous: boolean;
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
  mobile: ["movil", "movilcliente", "telefonocelular", "telefonomovil", "numeromovil", "telefono", "numero", "numeroemitido", "nemitido", "nums"],
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

/**
 * Select a mobile column only when one known header identifies it. A file
 * with two matching headers must be resolved by the user; selecting the first
 * column would silently block unrelated values.
 */
export function detectSalesMobileColumn(headers: readonly string[]): SalesMobileColumnDetection {
  const candidates = headers.flatMap((header, index) => aliases.mobile.includes(comparable(header) as never) ? [index] : []);
  return { candidates, selected: candidates.length === 1 ? candidates[0] : undefined, ambiguous: candidates.length > 1 };
}

export function suggestSalesColumnMapping(headers: readonly string[]): Partial<SalesColumnMapping> {
  const mobile = detectSalesMobileColumn(headers).selected;
  const soldAt = headerIndex(headers, aliases.soldAt);
  const status = headerIndex(headers, aliases.status);
  const advisor = headerIndex(headers, aliases.advisor);
  const campaign = headerIndex(headers, aliases.campaign);
  return {
    ...(mobile !== undefined ? { mobile } : {}),
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

export function previewSalesImport(rows: readonly SalesImportRow[], mapping: SalesColumnMapping, mode: SalesImportMode = "AVANZADA") {
  const seen = new Set<string>();
  const events: SalesEventPreview[] = [];
  for (const row of rows) {
    const rawMobile = row.cells[mapping.mobile] ?? "";
    const normalized = normalizeSpanishMobile(rawMobile);
    const invalid = spanishMobileExclusionReason(rawMobile);
    const duplicated = normalized ? seen.has(normalized) : false;
    if (normalized) seen.add(normalized);
    const statusText = mode === "AVANZADA" ? row.cells[mapping.status ?? -1] ?? "" : "";
    events.push({
      sourceRow: row.sourceRow,
      mobile: normalized,
      // The basic flow has no commercial-status dependency: every valid,
      // unique mobile is a confirmed sale and therefore a permanent block.
      saleStatus: mode === "BASICA" && normalized && !invalid && !duplicated ? "CONFIRMADA" : classifySaleStatus(statusText),
      originalStatus: mode === "BASICA" ? "IMPORTACION_BASICA" : safeText(statusText) ?? "",
      reason: invalid ? "MOVIL_INVALIDO" : duplicated ? "MOVIL_DUPLICADO" : "VALIDA",
      soldAt: mode === "AVANZADA" ? safeText(row.cells[mapping.soldAt ?? -1]) : null,
      advisor: mode === "AVANZADA" ? safeText(row.cells[mapping.advisor ?? -1]) : null,
      campaign: mode === "AVANZADA" ? safeText(row.cells[mapping.campaign ?? -1]) : null,
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
