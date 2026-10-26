import { randomUUID } from "node:crypto";
import nextEnv from "@next/env";
import { PrismaNeon } from "@prisma/adapter-neon";
import { PrismaClient } from "../generated/prisma/client.ts";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const connectionString = process.env.DATABASE_URL_AUDIT_TEST_UNPOOLED;
const expectedBranchId = "br-fragrant-heart-b5nue1w1";
if (!connectionString) throw new Error("DATABASE_URL_AUDIT_TEST_UNPOOLED is required.");
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString }) });
const operationKey = `sozar:first-real-test:concurrency-proof:${randomUUID()}`;

try {
  const branch = await prisma.$queryRaw<Array<{ branch_id: string | null }>>`SELECT current_setting('neon.branch_id', true) AS branch_id`;
  if (branch[0]?.branch_id !== expectedBranchId) throw new Error("The isolated Test branch identity did not match.");
  const [user, base] = await Promise.all([
    prisma.usuario.findFirst({ select: { id: true } }),
    prisma.base.findFirst({ select: { id: true } }),
  ]);
  const record = base ? await prisma.registro.findFirst({ where: { baseId: base.id }, select: { id: true } }) : null;
  if (!user || !base || !record) throw new Error("The isolated Test branch requires a user, base and record.");

  const attempt = (suffix: string) => prisma.$transaction(async (transaction) => {
    const approval = await transaction.aprobacionHlr.create({ data: { baseId: base.id, usuarioId: user.id, claveOperacion: `${operationKey}:approval:${suffix}`, estado: "APROBADA", maximoConsultas: 1, presupuestoMaxCentimos: 1, costeMaximoPorConsultaCentimos: 1, consultasReservadas: 1, gastoReservadoCentimos: 1, aprobadoEn: new Date() } });
    const consultation = await transaction.consultaHlr.create({ data: { proveedor: "sozar-concurrency-test", huellaMovil: `${operationKey}:${suffix}`, claveIdempotencia: `${operationKey}:idempotency:${suffix}`, estado: "EN_CURSO", tokenReserva: randomUUID(), reservadaEn: new Date(), reservaExpiraEn: new Date(Date.now() + 60_000), intentos: 1 } });
    await transaction.consultaHlrRegistro.create({ data: { consultaId: consultation.id, registroId: record.id, baseId: base.id, aprobacionId: approval.id } });
    await transaction.eventoConsultaHlr.create({ data: { consultaId: consultation.id, tipo: "COLA_PREPARADA", claveOperacion: operationKey, metadatos: { test: "concurrency" } } });
  });

  const attempts = await Promise.allSettled([attempt("a"), attempt("b")]);
  const fulfilled = attempts.filter((attempt) => attempt.status === "fulfilled").length;
  const rejected = attempts.filter((attempt) => attempt.status === "rejected").length;
  const events = await prisma.eventoConsultaHlr.count({ where: { claveOperacion: operationKey } });
  if (fulfilled !== 1 || rejected !== 1 || events !== 1) throw new Error(`The global one-shot reservation was not atomic (fulfilled=${fulfilled}, rejected=${rejected}, events=${events}).`);
  console.log(JSON.stringify({ branchId: expectedBranchId, reservations: fulfilled, rejected, providerCalls: 0, verified: true }));
} finally {
  await prisma.consultaHlr.deleteMany({ where: { proveedor: "sozar-concurrency-test" } });
  await prisma.aprobacionHlr.deleteMany({ where: { claveOperacion: { startsWith: operationKey } } });
  await prisma.$disconnect();
}
