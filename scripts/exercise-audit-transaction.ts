import { randomUUID } from "node:crypto";
import nextEnv from "@next/env";
import { PrismaNeon } from "@prisma/adapter-neon";
import { PrismaClient } from "../generated/prisma/client.ts";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const connectionString = process.env.DATABASE_URL_AUDIT_TEST_UNPOOLED;
if (!connectionString) throw new Error("DATABASE_URL_AUDIT_TEST_UNPOOLED is required.");

const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString }) });
const operationId = randomUUID();
const rollback = new Error("AUDIT_TEST_ROLLBACK");

try {
  await prisma.$transaction(async (transaction) => {
    const [user, base] = await Promise.all([
      transaction.usuario.findFirst({ select: { id: true } }),
      transaction.base.findFirst({ select: { id: true } }),
    ]);
    if (!user || !base) throw new Error("The isolated test branch requires one existing user and one existing base.");

    await transaction.eventoAuditoria.create({ data: {
      operacionId, accion: "BASE_CREADA", usuarioId: user.id, baseId: base.id,
      cantidad: 0, metadatos: { test: true },
    } });
    const duplicate = await transaction.eventoAuditoria.createMany({ data: [{
      operacionId, accion: "BASE_CREADA", usuarioId: user.id, baseId: base.id,
      cantidad: 0, metadatos: { test: true },
    }], skipDuplicates: true });
    if (duplicate.count !== 0) throw new Error("The unique operation constraint is not enforcing idempotency.");

    const exportRecord = await transaction.registroExportacion.create({ data: {
      operacionId: randomUUID(), usuarioId: user.id, baseId: base.id, tipo: "TEST",
      cantidad: 0, filtros: {}, metadatos: { test: true },
    } });
    const transition = await transaction.registroExportacion.updateMany({
      where: { id: exportRecord.id, estado: "GENERADO" },
      data: { estado: "DESCARGA_INICIADA", descargaIniciadaEn: new Date() },
    });
    if (transition.count !== 1) throw new Error("The export state transition failed.");
    throw rollback;
  });
} catch (error) {
  if (error !== rollback) throw error;
} finally {
  await prisma.$disconnect();
}

console.log(JSON.stringify({ verified: true, rolledBack: true }));
