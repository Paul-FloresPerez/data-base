import "server-only";

import { randomUUID } from "node:crypto";
import { Prisma } from "../../generated/prisma/client.ts";
import { prisma } from "./prisma.ts";
import { fingerprintHlrMobile, getRealHlrCacheExpiry } from "./sozar-control-plane.ts";
import { getSozarHttpConfigurationFromEnvironment, createServerSozarFirstRealTestFetchTransport, SozarHttpClient } from "./sozar-http-client.ts";
import { assertFirstRealSozarTestEnabled, getFirstRealSozarTestConfiguration, SOZAR_FIRST_REAL_TEST_OPERATION_KEY } from "./sozar-first-real-gate.ts";
import { planFirstRealSozarTest } from "./sozar-first-real-plan.ts";
import { describeSozarResponseShape, encryptSozarResponseForInspection } from "./sozar-response-inspection.ts";

export async function executeFirstRealSozarTest(input: { baseId: string; sourceRow: number; userId: string }) {
  assertFirstRealSozarTestEnabled();
  const configuration = getFirstRealSozarTestConfiguration();
  const record = await prisma.registro.findFirst({ where: { baseId: input.baseId, numeroFilaOriginal: input.sourceRow }, select: { id: true, movilNormalizado: true } });
  if (!record?.movilNormalizado) throw new Error("El registro seleccionado no contiene un móvil válido.");
  const fingerprint = fingerprintHlrMobile(record.movilNormalizado, configuration.mobileFingerprintKey);
  const [globalEvent, reusable, existing] = await Promise.all([
    prisma.eventoConsultaHlr.findUnique({ where: { claveOperacion: SOZAR_FIRST_REAL_TEST_OPERATION_KEY }, select: { id: true } }),
    prisma.resultadoHlrReal.findFirst({ where: { proveedor: "sozar", huellaMovil: fingerprint, vigenteHasta: { gt: new Date() } }, select: { id: true } }),
    prisma.consultaHlr.findFirst({ where: { proveedor: "sozar", huellaMovil: fingerprint }, select: { estado: true } }),
  ]);
  const plan = planFirstRealSozarTest({ baseId: input.baseId, mobile: record.movilNormalizado, mobileFingerprintKey: configuration.mobileFingerprintKey, maxCostCents: configuration.maxCostCents, globalOperationAlreadyRecorded: Boolean(globalEvent), hasReusableRealResult: Boolean(reusable), existingConsultationState: existing?.estado ?? null });
  if (plan.status !== "LISTO") return { status: plan.status, reason: plan.reason } as const;

  // The unique event is the durable global latch. A concurrent contender that
  // loses it rolls back before transport; no retry is attempted.
  const reserved = await prisma.$transaction(async (tx) => {
    const prior = await tx.eventoConsultaHlr.findUnique({ where: { claveOperacion: SOZAR_FIRST_REAL_TEST_OPERATION_KEY }, select: { id: true } });
    if (prior) return null;
    const approval = await tx.aprobacionHlr.create({ data: { baseId: input.baseId, usuarioId: input.userId, claveOperacion: `${SOZAR_FIRST_REAL_TEST_OPERATION_KEY}:approval`, estado: "APROBADA", maximoConsultas: 1, presupuestoMaxCentimos: configuration.maxCostCents, costeMaximoPorConsultaCentimos: configuration.maxCostCents, consultasReservadas: 1, gastoReservadoCentimos: configuration.maxCostCents, aprobadoEn: new Date() } });
    const consultation = await tx.consultaHlr.create({ data: { proveedor: "sozar", huellaMovil: plan.mobileFingerprint, claveIdempotencia: plan.idempotencyKey, estado: "EN_CURSO", tokenReserva: randomUUID(), reservadaEn: new Date(), reservaExpiraEn: new Date(Date.now() + 15 * 60_000), intentos: 1 } });
    await tx.consultaHlrRegistro.create({ data: { consultaId: consultation.id, registroId: record.id, baseId: input.baseId, aprobacionId: approval.id } });
    await tx.eventoConsultaHlr.create({ data: { consultaId: consultation.id, tipo: "COLA_PREPARADA", claveOperacion: SOZAR_FIRST_REAL_TEST_OPERATION_KEY, metadatos: { mode: "single-controlled" } } });
    return consultation;
  });
  if (!reserved) return { status: "BLOQUEADO", reason: "LIMITE_GLOBAL" } as const;
  try {
    const raw = await new SozarHttpClient(getSozarHttpConfigurationFromEnvironment(), createServerSozarFirstRealTestFetchTransport(), "first-real-test").lookupRaw(plan.mobile);
    const encrypted = encryptSozarResponseForInspection(raw, configuration.encryptedResponseKey);
    const storedResponse: Prisma.InputJsonObject = { encrypted: encrypted as unknown as Prisma.InputJsonObject, shape: describeSozarResponseShape(raw) as unknown as Prisma.InputJsonValue, mapping: "documentation_required" };
    const result = await prisma.resultadoHlrReal.upsert({ where: { proveedor_huellaMovil: { proveedor: "sozar", huellaMovil: plan.mobileFingerprint } }, create: { proveedor: "sozar", huellaMovil: plan.mobileFingerprint, resultado: storedResponse, vigenteHasta: getRealHlrCacheExpiry(new Date()) }, update: { resultado: storedResponse, consultadoEn: new Date(), vigenteHasta: getRealHlrCacheExpiry(new Date()) } });
    await prisma.consultaHlr.update({ where: { id: reserved.id }, data: { estado: "EXITOSA", resultadoId: result.id } });
    return { status: "RESPUESTA_CIFRADA_PENDIENTE_DE_CONTRATO" } as const;
  } catch {
    await prisma.consultaHlr.update({ where: { id: reserved.id }, data: { estado: "INCIERTA" } });
    return { status: "INCIERTA" } as const;
  }
}
