import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import nextEnv from "@next/env";
import { Client } from "pg";

nextEnv.loadEnvConfig(process.cwd());

const url = process.env.PRISMA_MIGRATION_TEST_URL;
const expectedBranch = process.env.PRISMA_MIGRATION_TEST_BRANCH_ID;
if (!url || !expectedBranch) throw new Error("La conexión segura de Test no está configurada.");

const identity = new Client({ connectionString: url });
await identity.connect();
try {
  const result = await identity.query<{ branch_id: string | null }>("SELECT current_setting('neon.branch_id', true) AS branch_id");
  if (result.rows[0]?.branch_id !== expectedBranch) throw new Error("La identidad de Neon Test no coincide.");
} finally {
  await identity.end();
}

process.env.DATABASE_URL = url;
const { prisma } = await import("../lib/server/prisma.ts");
const { markFirstRealSozarConsultationUncertain } = await import("../lib/server/sozar-first-real-executor.ts");
const testRunId = randomUUID();
const provider = `sozar-uncertain-test-${testRunId}`;

try {
  const consultation = await prisma.consultaHlr.create({
    data: {
      proveedor: provider,
      huellaMovil: `fixture-${testRunId}`,
      claveIdempotencia: `fixture-${testRunId}`,
      estado: "EN_CURSO",
      tokenReserva: randomUUID(),
      reservadaEn: new Date(),
      reservaExpiraEn: new Date(Date.now() + 60_000),
      intentos: 1,
    },
  });
  const event = await prisma.eventoConsultaHlr.create({
    data: {
      consultaId: consultation.id,
      tipo: "COLA_PREPARADA",
      claveOperacion: `sozar:first-real-uncertain:${testRunId}`,
      metadatos: { synthetic: true, testRunId, automaticRetries: false },
    },
  });

  const uncertain = await markFirstRealSozarConsultationUncertain(consultation.id);
  assert.equal(uncertain.estado, "INCIERTA");
  assert.equal(uncertain.tokenReserva, null);
  assert.equal(uncertain.reservadaEn, null);
  assert.equal(uncertain.reservaExpiraEn, null);
  assert.equal(uncertain.intentos, 1);
  assert.equal(uncertain.creadoEn.getTime(), consultation.creadoEn.getTime());

  const repeated = await markFirstRealSozarConsultationUncertain(consultation.id);
  assert.equal(repeated.estado, "INCIERTA");
  const persistedEvent = await prisma.eventoConsultaHlr.findUnique({ where: { id: event.id }, select: { id: true, consultaId: true } });
  assert.deepEqual(persistedEvent, { id: event.id, consultaId: consultation.id });
  console.log(JSON.stringify({ target: "test", branchId: expectedBranch, testRunId, transition: "EN_CURSO->INCIERTA", reservationCleared: true, auditPreserved: true, repeatedTransition: "idempotent", fixturesCleaned: true }));
} finally {
  const consultations = await prisma.consultaHlr.findMany({ where: { proveedor: provider }, select: { id: true } });
  const consultationIds = consultations.map((consultation) => consultation.id);
  if (consultationIds.length) await prisma.eventoConsultaHlr.deleteMany({ where: { consultaId: { in: consultationIds } } });
  if (consultationIds.length) await prisma.consultaHlr.deleteMany({ where: { id: { in: consultationIds } } });
  await prisma.$disconnect();
}
