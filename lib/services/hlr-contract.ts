/**
 * Normalized result shared by every enrichment provider. It intentionally does
 * not mirror an external API response: supplier fields are unknown until their
 * documentation is supplied and reviewed.
 */
export interface HlrEnrichmentResult {
  mobile: string;
  operadorActual: string | null;
  operadorOriginal: string | null;
  operadorDonante: string | null;
  fechaPortabilidad: string | null;
  /** Set by the server when a real provider response is accepted. */
  consultedAt: string;
  source: "API_REAL" | "TEST";
}

/** Kept alongside the base so historical Excel data is never relabelled as live data. */
export interface HlrConsultationMetadata {
  normalizedMobile: string;
  provider: "sozar";
  consultedAt: string;
  source: "API_REAL";
}

export interface HlrProvider {
  readonly id: string;
  readonly mode: "real" | "test";
  lookup(mobile: string): Promise<HlrEnrichmentResult>;
}

export interface ExistingEnrichmentFields {
  operadorActual: string;
  operadorOriginal: string;
  operadorDonante: string;
  fechaPortabilidad: string | null;
}

/** Maps the normalized contract to fields already understood by the workbook. */
export function toExistingEnrichmentFields(result: HlrEnrichmentResult): ExistingEnrichmentFields {
  return {
    operadorActual: result.operadorActual ?? "",
    operadorOriginal: result.operadorOriginal ?? "",
    // The existing workbook calls this field "Portabilidad Desde". It receives
    // the donor only when the provider explicitly documents that field.
    operadorDonante: result.operadorDonante ?? "",
    fechaPortabilidad: result.fechaPortabilidad,
  };
}
