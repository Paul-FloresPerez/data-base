import "server-only";

import { randomUUID } from "node:crypto";
import { Prisma } from "../../generated/prisma/client.ts";
import { prisma } from "./prisma.ts";
import { HlrApprovalLimitError } from "./sozar-control-plane.ts";
import { SOZAR_EXECUTION_CODE_GATE, SozarExecutionBlockedError } from "./sozar-http-client.ts";

export type ReservedHlrConsultation = {
  id: string;
  mobileFingerprint: string;
  reservationToken: string;
};

/**
 * Future-only atomic reservation. PostgreSQL locks one pending job with
 * SKIP LOCKED and consumes both quota and budget in the same transaction.
 * It is deliberately unreachable while the source-code execution gate is
 * false. INCIERTA is intentionally absent from the candidate state.
 */
export async function reserveApprovedHlrConsultation(reservationTtlMs: number): Promise<ReservedHlrConsultation | null> {
  if (!SOZAR_EXECUTION_CODE_GATE) throw new SozarExecutionBlockedError();
  if (!Number.isInteger(reservationTtlMs) || reservationTtlMs < 1_000 || reservationTtlMs > 15 * 60_000) {
    throw new HlrApprovalLimitError("La reserva HLR debe durar entre un segundo y quince minutos.");
  }

  const reservationToken = randomUUID();
  const expiresAt = new Date(Date.now() + reservationTtlMs);
  const rows = await prisma.$queryRaw<Array<{ id: string; huella_movil: string }>>(Prisma.sql`
    WITH candidato AS (
      SELECT consulta.id, destino.aprobacion_id
      FROM "consultas_hlr" AS consulta
      INNER JOIN "consulta_hlr_registros" AS destino ON destino.consulta_id = consulta.id
      INNER JOIN "aprobaciones_hlr" AS aprobacion ON aprobacion.id = destino.aprobacion_id
      WHERE consulta.estado = 'PENDIENTE'
        AND aprobacion.estado = 'APROBADA'
        AND aprobacion.consultas_reservadas < aprobacion.maximo_consultas
        AND aprobacion.gasto_reservado_centimos + aprobacion.coste_maximo_por_consulta_centimos <= aprobacion.presupuesto_max_centimos
      ORDER BY consulta.creado_en ASC
      FOR UPDATE OF consulta, aprobacion SKIP LOCKED
      LIMIT 1
    ), presupuesto AS (
      UPDATE "aprobaciones_hlr" AS aprobacion
      SET "consultas_reservadas" = aprobacion."consultas_reservadas" + 1,
          "gasto_reservado_centimos" = aprobacion."gasto_reservado_centimos" + aprobacion."coste_maximo_por_consulta_centimos",
          "actualizado_en" = CURRENT_TIMESTAMP
      FROM candidato
      WHERE aprobacion.id = candidato.aprobacion_id
      RETURNING aprobacion.id
    )
    UPDATE "consultas_hlr" AS consulta
    SET "estado" = 'EN_CURSO',
        "token_reserva" = ${reservationToken},
        "reservada_en" = CURRENT_TIMESTAMP,
        "reserva_expira_en" = ${expiresAt},
        "intentos" = consulta."intentos" + 1,
        "actualizado_en" = CURRENT_TIMESTAMP
    FROM candidato, presupuesto
    WHERE consulta.id = candidato.id
    RETURNING consulta.id, consulta.huella_movil
  `);

  const row = rows[0];
  return row ? { id: row.id, mobileFingerprint: row.huella_movil, reservationToken } : null;
}
