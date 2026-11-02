-- Additive global commercial reservations. Historical lots and sales remain unchanged.
ALTER TYPE "AccionAuditoria" ADD VALUE IF NOT EXISTS 'RESERVAS_CREADAS';
ALTER TYPE "AccionAuditoria" ADD VALUE IF NOT EXISTS 'RESERVA_LIBERADA';

CREATE TYPE "EstadoReservaComercial" AS ENUM ('ACTIVA', 'LIBERADA');

CREATE TABLE "reservas_comerciales" (
  "id" UUID NOT NULL,
  "movil_normalizado" TEXT NOT NULL,
  "base_id" UUID NOT NULL,
  "lote_id" UUID NOT NULL,
  "campana" "Campana" NOT NULL,
  "usuario_id" UUID NOT NULL,
  "asesor" TEXT,
  "operacion_id" TEXT NOT NULL,
  "estado" "EstadoReservaComercial" NOT NULL DEFAULT 'ACTIVA',
  "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "liberada_en" TIMESTAMP(3),
  "liberada_por_usuario_id" UUID,
  "operacion_liberacion_id" TEXT,
  "metadatos" JSONB NOT NULL,
  CONSTRAINT "reservas_comerciales_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "reservas_comerciales_operacion_id_key" ON "reservas_comerciales"("operacion_id");
CREATE UNIQUE INDEX "reservas_comerciales_operacion_liberacion_id_key" ON "reservas_comerciales"("operacion_liberacion_id");
CREATE UNIQUE INDEX "reservas_comerciales_movil_activa_key" ON "reservas_comerciales"("movil_normalizado") WHERE "estado" = 'ACTIVA';
CREATE INDEX "reservas_comerciales_movil_normalizado_estado_idx" ON "reservas_comerciales"("movil_normalizado", "estado");
CREATE INDEX "reservas_comerciales_base_id_creado_en_idx" ON "reservas_comerciales"("base_id", "creado_en");
CREATE INDEX "reservas_comerciales_lote_id_idx" ON "reservas_comerciales"("lote_id");

ALTER TABLE "reservas_comerciales" ADD CONSTRAINT "reservas_comerciales_base_id_fkey" FOREIGN KEY ("base_id") REFERENCES "bases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "reservas_comerciales" ADD CONSTRAINT "reservas_comerciales_lote_id_fkey" FOREIGN KEY ("lote_id") REFERENCES "lotes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "reservas_comerciales" ADD CONSTRAINT "reservas_comerciales_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "reservas_comerciales" ADD CONSTRAINT "reservas_comerciales_liberada_por_usuario_id_fkey" FOREIGN KEY ("liberada_por_usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
