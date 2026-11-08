import "server-only";

import { randomUUID } from "node:crypto";
import { Prisma } from "../../generated/prisma/client.ts";
import { prisma } from "./prisma.ts";
import { fingerprintHlrMobile, getRealHlrCacheExpiry } from "./sozar-control-plane.ts";
import {
  createServerSozarFirstRealTestFetchTransport,
  getSozarHttpConfigurationFromEnvironment,
  SozarConfigurationError,
  SozarExecutionBlockedError,
  SozarHttpClient,
  SozarInvalidJsonError,
  SozarProviderHttpError,
} from "./sozar-http-client.ts";
import {
  assertFirstRealSozarTestEnabled,
  getFirstRealSozarAttemptPolicy,
  getFirstRealSozarTestConfiguration,
  SOZAR_FIRST_REAL_TEST_OPERATION_KEY,
} from "./sozar-first-real-gate.ts";
import { planFirstRealSozarTest } from "./sozar-first-real-plan.ts";
import { describeSozarResponseShape, encryptSozarResponseForInspection } from "./sozar-response-inspection.ts";
import { getFirstRealSozarEligibleRecord } from "./sozar-first-real-selection.ts";

type AttemptFailure = {
  state: "FALLIDA" | "INCIERTA";
  phase: "LOCAL_PREVIO_ENVIO" | "RESPUESTA_HTTP" | "RESPUESTA_JSON_INVALIDA" | "TRANSPORTE_INCIERTO";
  code: string;
  httpStatus: number | null;
};

function attemptEventKey(attemptId: string, phase: string, operationId: string = randomUUID()) {
  return `${SOZAR_FIRST_REAL_TEST_OPERATION_KEY}:attempt:${attemptId}:${phase}:${operationId}`;
}

const firstRealAttemptWhere = {
  proveedor: "sozar",
  destinos: { some: { aprobacion: { claveOperacion: { startsWith: SOZAR_FIRST_REAL_TEST_OPERATION_KEY } } } },
} as const;

function classifyAttemptFailure(error: unknown): AttemptFailure {
  if (error instanceof SozarConfigurationError || error instanceof SozarExecutionBlockedError) return { state: "FALLIDA", phase: "LOCAL_PREVIO_ENVIO", code: "CONFIGURACION_LOCAL", httpStatus: null };
  if (error instanceof SozarProviderHttpError) return { state: "FALLIDA", phase: "RESPUESTA_HTTP", code: `HTTP_${error.status}`, httpStatus: error.status };
  if (error instanceof SozarInvalidJsonError) return { state: "INCIERTA", phase: "RESPUESTA_JSON_INVALIDA", code: "JSON_INVALIDO", httpStatus: error.status };
  if (error instanceof Error && error.name === "AbortError") return { state: "INCIERTA", phase: "TRANSPORTE_INCIERTO", code: "TIMEOUT_O_ABORTADO", httpStatus: null };
  return { state: "INCIERTA", phase: "TRANSPORTE_INCIERTO", code: "TRANSPORTE_SIN_RESPUESTA_VERIFICABLE", httpStatus: null };
}

async function recordTerminalAttempt(input: { consultationId: string; failure: AttemptFailure }) {
  return prisma.$transaction(async (tx) => {
    const consultation = await tx.consultaHlr.update({
      where: { id: input.consultationId },
      data: { estado: input.failure.state, tokenReserva: null, reservadaEn: null, reservaExpiraEn: null },
    });
    await tx.eventoConsultaHlr.create({
      data: {
        consultaId: consultation.id,
        tipo: input.failure.state === "INCIERTA" ? "RESULTADO_INCIERTO" : "RESULTADO_FALLIDO",
        claveOperacion: attemptEventKey(consultation.id, input.failure.phase),
        metadatos: { attemptId: consultation.id, phase: input.failure.phase, code: input.failure.code, httpStatus: input.failure.httpStatus, automaticRetries: false },
      },
    });
    return consultation;
  });
}

/** Terminal uncertain attempts retain their audit identity but no active reservation. */
export async function markFirstRealSozarConsultationUncertain(consultationId: string) {
  return recordTerminalAttempt({
    consultationId,
    failure: { state: "INCIERTA", phase: "TRANSPORTE_INCIERTO", code: "RESULTADO_DESCONOCIDO", httpStatus: null },
  });
}

async function markFirstRealSozarConsultationSuccessful(consultationId: string, resultId: string) {
  return prisma.$transaction(async (tx) => {
    const consultation = await tx.consultaHlr.update({
      where: { id: consultationId },
      data: { estado: "EXITOSA", resultadoId: resultId, tokenReserva: null, reservadaEn: null, reservaExpiraEn: null },
    });
    await tx.eventoConsultaHlr.create({
      data: {
        consultaId: consultation.id,
        tipo: "RESULTADO_RECIBIDO",
        claveOperacion: attemptEventKey(consultation.id, "RESPUESTA_CIFRADA"),
        metadatos: { attemptId: consultation.id, phase: "RESPUESTA_CIFRADA", automaticRetries: false },
      },
    });
    return consultation;
  });
}

export type FirstRealAttemptResolution = "MARCAR_INCIERTA" | "NO_ENVIADA_CONFIRMADA" | "MANTIENE_INCIERTA";

/** Administrative reconciliation never guesses a provider outcome. */
export async function resolveFirstRealSozarAttempt(input: {
  attemptId: string;
  userId: string;
  operationId: string;
  resolution: FirstRealAttemptResolution;
  evidenceReference: string;
}) {
  if (!input.userId.trim() || !input.operationId.trim() || input.evidenceReference.trim().length < 8 || input.evidenceReference.length > 240) {
    throw new Error("La resolución administrativa requiere usuario, operación e identificador de evidencia válidos.");
  }
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`sozar-attempt:${input.attemptId}`}, 0))`);
    const attempt = await tx.consultaHlr.findUnique({ where: { id: input.attemptId }, select: { id: true, proveedor: true, estado: true } });
    if (!attempt || attempt.proveedor !== "sozar" || !["EN_CURSO", "INCIERTA"].includes(attempt.estado)) {
      throw new Error("El intento no está disponible para resolución administrativa.");
    }
    if (attempt.estado === "EN_CURSO" && input.resolution !== "MARCAR_INCIERTA") {
      throw new Error("Un intento EN_CURSO requiere primero marcarse INCIERTA con evidencia.");
    }
    const key = attemptEventKey(attempt.id, "RESOLUCION_ADMINISTRATIVA", input.operationId);
    const prior = await tx.eventoConsultaHlr.findUnique({ where: { claveOperacion: key }, select: { id: true } });
    if (prior) return { state: attempt.estado, reused: true } as const;
    if (input.resolution === "NO_ENVIADA_CONFIRMADA") {
      await tx.consultaHlr.update({ where: { id: attempt.id }, data: { estado: "FALLIDA", tokenReserva: null, reservadaEn: null, reservaExpiraEn: null } });
    } else if (input.resolution === "MARCAR_INCIERTA") {
      await tx.consultaHlr.update({ where: { id: attempt.id }, data: { estado: "INCIERTA", tokenReserva: null, reservadaEn: null, reservaExpiraEn: null } });
    }
    await tx.eventoConsultaHlr.create({
      data: {
        consultaId: attempt.id,
        tipo: input.resolution === "NO_ENVIADA_CONFIRMADA" ? "RESULTADO_FALLIDO" : "RESULTADO_INCIERTO",
        claveOperacion: key,
        metadatos: { attemptId: attempt.id, phase: "RESOLUCION_ADMINISTRATIVA", resolution: input.resolution, evidenceReference: input.evidenceReference.trim(), resolvedByUserId: input.userId, automaticRetries: false },
      },
    });
    return { state: input.resolution === "NO_ENVIADA_CONFIRMADA" ? "FALLIDA" : "INCIERTA", reused: false } as const;
  });
}

export async function executeFirstRealSozarTest(input: { baseId: string; sourceRow: number; userId: string }) {
  assertFirstRealSozarTestEnabled();
  const configuration = getFirstRealSozarTestConfiguration();
  const policy = getFirstRealSozarAttemptPolicy();
  const record = await getFirstRealSozarEligibleRecord(input.baseId, input.sourceRow);
  const fingerprint = fingerprintHlrMobile(record.movilNormalizado, configuration.mobileFingerprintKey);
  const [reusable, existing, attempts] = await Promise.all([
    prisma.resultadoHlrReal.findFirst({ where: { proveedor: "sozar", huellaMovil: fingerprint, vigenteHasta: { gt: new Date() } }, select: { id: true } }),
    prisma.consultaHlr.findFirst({ where: { proveedor: "sozar", huellaMovil: fingerprint }, select: { estado: true } }),
    prisma.consultaHlr.count({ where: firstRealAttemptWhere }),
  ]);
  const plan = planFirstRealSozarTest({ baseId: input.baseId, mobile: record.movilNormalizado, mobileFingerprintKey: configuration.mobileFingerprintKey, attemptLimitReached: attempts >= policy.maxAttempts, hasReusableRealResult: Boolean(reusable), existingConsultationState: existing?.estado ?? null });
  if (plan.status !== "LISTO") return { status: plan.status, reason: plan.reason } as const;

  const attemptId = randomUUID();
  const reserved = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${SOZAR_FIRST_REAL_TEST_OPERATION_KEY}, 0))`);
    const [attemptCount, prior] = await Promise.all([
      tx.consultaHlr.count({ where: firstRealAttemptWhere }),
      tx.consultaHlr.findFirst({ where: { proveedor: "sozar", huellaMovil: plan.mobileFingerprint }, select: { estado: true } }),
    ]);
    if (attemptCount >= policy.maxAttempts) return { status: "LIMITE_GLOBAL" } as const;
    if (prior) return { status: "COLA_EXISTENTE" } as const;
    const approval = await tx.aprobacionHlr.create({
      data: {
        baseId: input.baseId, usuarioId: input.userId, claveOperacion: `${SOZAR_FIRST_REAL_TEST_OPERATION_KEY}:approval:${attemptId}`,
        estado: "PREPARADA", maximoConsultas: 1, presupuestoMaxCentimos: policy.budgetMaxCents,
        costeMaximoPorConsultaCentimos: policy.maxCostPerAttemptCents, consultasReservadas: 1, gastoReservadoCentimos: policy.maxCostPerAttemptCents,
      },
    });
    const consultation = await tx.consultaHlr.create({
      data: {
        id: attemptId, proveedor: "sozar", huellaMovil: plan.mobileFingerprint, claveIdempotencia: `${plan.idempotencyKey}:${attemptId}`,
        estado: "EN_CURSO", tokenReserva: randomUUID(), reservadaEn: new Date(), reservaExpiraEn: new Date(Date.now() + 15 * 60_000), intentos: 1,
      },
    });
    await tx.consultaHlrRegistro.create({ data: { consultaId: consultation.id, registroId: record.id, baseId: input.baseId, aprobacionId: approval.id } });
    await tx.eventoConsultaHlr.create({
      data: {
        consultaId: consultation.id, tipo: "COLA_PREPARADA", claveOperacion: attemptEventKey(consultation.id, "RESERVA_CREADA"),
        metadatos: { attemptId: consultation.id, phase: "RESERVA_CREADA", mode: "single-controlled", explicitChargeConfirmation: true, maxAttempts: policy.maxAttempts, automaticRetries: false },
      },
    });
    return { status: "RESERVADA", consultation } as const;
  });
  if (reserved.status !== "RESERVADA") return { status: "BLOQUEADO", reason: reserved.status } as const;

  let providerHttpStatus: number | null = null;
  try {
    await prisma.eventoConsultaHlr.create({
      data: {
        consultaId: reserved.consultation.id, tipo: "RESERVA_CREADA", claveOperacion: attemptEventKey(reserved.consultation.id, "SOLICITUD_PREPARADA"),
        metadatos: { attemptId: reserved.consultation.id, phase: "SOLICITUD_PREPARADA", automaticRetries: false },
      },
    });
    const raw = await new SozarHttpClient(getSozarHttpConfigurationFromEnvironment(), createServerSozarFirstRealTestFetchTransport(), "first-real-test").lookupRaw(plan.mobile);
    providerHttpStatus = 200;
    const encrypted = encryptSozarResponseForInspection(raw, configuration.encryptedResponseKey);
    const storedResponse: Prisma.InputJsonObject = { encrypted: encrypted as unknown as Prisma.InputJsonObject, shape: describeSozarResponseShape(raw) as unknown as Prisma.InputJsonValue, mapping: "documentation_required" };
    const result = await prisma.resultadoHlrReal.upsert({
      where: { proveedor_huellaMovil: { proveedor: "sozar", huellaMovil: plan.mobileFingerprint } },
      create: { proveedor: "sozar", huellaMovil: plan.mobileFingerprint, resultado: storedResponse, vigenteHasta: getRealHlrCacheExpiry(new Date()) },
      update: { resultado: storedResponse, consultadoEn: new Date(), vigenteHasta: getRealHlrCacheExpiry(new Date()) },
    });
    await markFirstRealSozarConsultationSuccessful(reserved.consultation.id, result.id);
    return { status: "RESPUESTA_CIFRADA_PENDIENTE_DE_CONTRATO", attemptId: reserved.consultation.id } as const;
  } catch (error) {
    const failure = classifyAttemptFailure(error);
    if (providerHttpStatus !== null && failure.httpStatus === null) failure.httpStatus = providerHttpStatus;
    await recordTerminalAttempt({ consultationId: reserved.consultation.id, failure });
    return { status: failure.state, attemptId: reserved.consultation.id } as const;
  }
}
