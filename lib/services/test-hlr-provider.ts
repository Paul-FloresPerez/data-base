import type { HlrEnrichmentResult, HlrProvider } from "./hlr-contract.ts";

/**
 * Fixture-only provider. It shares the production contract but does not import
 * network code or external credentials.
 */
export class TestHlrProvider implements HlrProvider {
  readonly id = "test-fixture";
  readonly mode = "test" as const;

  async lookup(mobile: string): Promise<HlrEnrichmentResult> {
    if (!/^[67]\d{8}$/.test(mobile)) throw new Error("El móvil de prueba no es válido.");
    return {
      mobile,
      operadorActual: "Operador de prueba A",
      operadorOriginal: "Operador de prueba B",
      operadorDonante: "Operador de prueba B",
      fechaPortabilidad: "2024-01-15",
      consultedAt: "2024-01-15T00:00:00.000Z",
      source: "TEST",
    };
  }
}
