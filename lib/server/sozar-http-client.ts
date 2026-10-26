import "server-only";

import { mapDocumentedSozarResponse, validateSpanishMobileForSozar } from "./sozar-hlr-provider.ts";
import { assertFirstRealSozarTestEnabled } from "./sozar-first-real-gate.ts";
import type { HlrEnrichmentResult } from "../services/hlr-contract.ts";

export type SozarAuthentication =
  | { kind: "none" }
  | { kind: "bearer"; token: string }
  | { kind: "header"; headerName: string; secret: string };

export interface SozarHttpConfiguration {
  endpointTemplate: string;
  allowedHosts: readonly string[];
  timeoutMs: number;
  authentication: SozarAuthentication;
}

const SOZAR_ALLOWED_HOSTS = ["apisozarusac.com"] as const;

/**
 * Reads only server-side environment values. These values configure a future
 * client; they cannot open the execution gate below. A host change remains a
 * reviewed source-code change, rather than an environment-only switch.
 */
export function getSozarHttpConfigurationFromEnvironment(): SozarHttpConfiguration {
  const authenticationMode = process.env.SOZAR_AUTH_MODE ?? "none";
  const authentication: SozarAuthentication = authenticationMode === "bearer"
    ? { kind: "bearer", token: process.env.SOZAR_API_TOKEN ?? "" }
    : authenticationMode === "header"
      ? { kind: "header", headerName: process.env.SOZAR_AUTH_HEADER ?? "", secret: process.env.SOZAR_AUTH_SECRET ?? "" }
      : { kind: "none" };

  if (!["none", "bearer", "header"].includes(authenticationMode)) {
    throw new SozarConfigurationError("SOZAR_AUTH_MODE debe ser none, bearer o header.");
  }

  return {
    endpointTemplate: process.env.SOZAR_ENDPOINT_TEMPLATE ?? "https://apisozarusac.com/BackendJava/api/numbers/{numero}",
    allowedHosts: SOZAR_ALLOWED_HOSTS,
    timeoutMs: Number(process.env.SOZAR_TIMEOUT_MS ?? "10000"),
    authentication,
  };
}

export interface SozarHttpResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

export type SozarHttpTransport = (url: string, init: RequestInit) => Promise<SozarHttpResponse>;
type SozarExecutionScope = "shared-hlr" | "first-real-test";
const firstRealTestTransportBrand = Symbol("first-real-test-transport");
type FirstRealTestTransport = SozarHttpTransport & { [firstRealTestTransportBrand]: true };

/**
 * Deliberate release gate. Environment values cannot enable billable traffic:
 * enabling it requires a reviewed source-code change and a new deployment.
 */
export const SOZAR_EXECUTION_CODE_GATE = false;

export class SozarExecutionBlockedError extends Error {
  constructor() {
    super("Las consultas reales de Sozar siguen bloqueadas por la puerta de seguridad de código.");
  }
}

export class SozarConfigurationError extends Error {}
export class SozarContractPendingError extends Error {
  constructor() {
    super("La respuesta de Sozar no puede procesarse hasta disponer de un contrato JSON documentado.");
  }
}

/**
 * The only built-in network transport. It cannot even be obtained while the
 * reviewed source-code gate is closed, so environment changes cannot turn a
 * deployment into a billable caller. Tests inject a fake transport instead.
 */
export function createServerSozarFetchTransport(): SozarHttpTransport {
  if (!SOZAR_EXECUTION_CODE_GATE) throw new SozarExecutionBlockedError();
  return async (url, init) => fetch(url, init);
}

/**
 * The only exception to the shared HLR gate: a reviewed, one-shot route may
 * use this transport after its own stricter source-code gate is opened. It
 * does not enable queue workers, providers or bulk processing.
 */
export function createServerSozarFirstRealTestFetchTransport(): SozarHttpTransport {
  assertFirstRealSozarTestEnabled();
  const transport = (async (url: string, init: RequestInit) => fetch(url, init)) as unknown as FirstRealTestTransport;
  Object.defineProperty(transport, firstRealTestTransportBrand, { value: true });
  return transport;
}

function assertConfiguration(configuration: SozarHttpConfiguration) {
  if (!Number.isInteger(configuration.timeoutMs) || configuration.timeoutMs < 1_000 || configuration.timeoutMs > 30_000) {
    throw new SozarConfigurationError("El tiempo de espera de Sozar debe estar entre 1 y 30 segundos.");
  }
  const endpoint = new URL(configuration.endpointTemplate.replace("{numero}", "600000000"));
  const hostIsAllowed = configuration.allowedHosts.some((host) => host.toLowerCase() === endpoint.hostname.toLowerCase());
  if (endpoint.protocol !== "https:" || !hostIsAllowed || !configuration.endpointTemplate.includes("{numero}")) {
    throw new SozarConfigurationError("El endpoint de Sozar no cumple la lista de dominios permitidos.");
  }
  if (configuration.authentication.kind === "bearer" && !configuration.authentication.token.trim()) throw new SozarConfigurationError("Falta el secreto bearer de Sozar.");
  if (configuration.authentication.kind === "header" && (!configuration.authentication.headerName.trim() || !configuration.authentication.secret.trim())) throw new SozarConfigurationError("Falta la autenticación por cabecera de Sozar.");
}

export function buildSozarRequest(configuration: SozarHttpConfiguration, mobile: string): { url: string; init: RequestInit } {
  assertConfiguration(configuration);
  const normalizedMobile = validateSpanishMobileForSozar(mobile);
  const url = configuration.endpointTemplate.replace("{numero}", encodeURIComponent(normalizedMobile));
  const headers = new Headers({ accept: "application/json" });
  if (configuration.authentication.kind === "bearer") headers.set("authorization", `Bearer ${configuration.authentication.token}`);
  if (configuration.authentication.kind === "header") headers.set(configuration.authentication.headerName, configuration.authentication.secret);
  return { url, init: { method: "GET", headers } };
}

export class SozarHttpClient {
  private readonly configuration: SozarHttpConfiguration;
  private readonly transport: SozarHttpTransport;
  private readonly executionScope: SozarExecutionScope;

  constructor(
    configuration: SozarHttpConfiguration,
    transport: SozarHttpTransport,
    executionScope: SozarExecutionScope = "shared-hlr",
  ) {
    this.configuration = configuration;
    this.transport = transport;
    this.executionScope = executionScope;
  }

  /** Server-only raw response path for the one approved contract-inspection request. */
  async lookupRaw(mobile: string): Promise<unknown> {
    const request = buildSozarRequest(this.configuration, mobile);
    // Immediately before the only transport invocation, require either the
    // normal shared gate or a branded one-shot transport. A caller cannot
    // grant itself the exceptional scope with an arbitrary transport.
    if (this.executionScope === "first-real-test") {
      if (!(this.transport as Partial<FirstRealTestTransport>)[firstRealTestTransportBrand]) throw new SozarExecutionBlockedError();
      assertFirstRealSozarTestEnabled();
    } else if (!SOZAR_EXECUTION_CODE_GATE) {
      throw new SozarExecutionBlockedError();
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.configuration.timeoutMs);
    try {
      const response = await this.transport(request.url, { ...request.init, signal: controller.signal });
      if (!response.ok) throw new Error(`Sozar respondió con estado ${response.status}.`);
      return response.json();
    } finally {
      clearTimeout(timeout);
    }
  }

  async lookup(mobile: string): Promise<HlrEnrichmentResult> {
    const mapped = mapDocumentedSozarResponse(validateSpanishMobileForSozar(mobile), await this.lookupRaw(mobile));
      if (mapped.status !== "mapped") throw new SozarContractPendingError();
      return mapped.result;
  }
}
