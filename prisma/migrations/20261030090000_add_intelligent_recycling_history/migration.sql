-- Additive, append-only history for intelligent recycling. No source record is removed.
CREATE TYPE "EstadoEjecucionReciclaje" AS ENUM ('PREPARADA', 'EVALUANDO', 'EVALUADA', 'BASE_GENERADA', 'ERROR');
CREATE TYPE "EstadoResultadoReciclaje" AS ENUM ('ELEGIBLE', 'BLOQUEADO_VENTA', 'REVISION_GESTION', 'REVISION_CONFLICTO', 'REVISION_PERMANENCIA', 'FUERA_RANGO_HISTORICO');

ALTER TABLE "ejecuciones_reciclaje"
  ADD COLUMN "operacion_id" TEXT,
  ADD COLUMN "base_reciclada_id" UUID,
  ADD COLUMN "fecha_efectiva" DATE;

UPDATE "ejecuciones_reciclaje"
SET "operacion_id" = "id"::text,
    "fecha_efectiva" = "creado_en"::date;

ALTER TABLE "ejecuciones_reciclaje"
  ALTER COLUMN "operacion_id" SET NOT NULL,
  ALTER COLUMN "fecha_efectiva" SET NOT NULL;

ALTER TABLE "ejecuciones_reciclaje" ALTER COLUMN "estado" DROP DEFAULT;
ALTER TABLE "ejecuciones_reciclaje"
  ALTER COLUMN "estado" TYPE "EstadoEjecucionReciclaje"
  USING (CASE WHEN "estado" IN ('PREPARADA', 'EVALUANDO', 'EVALUADA', 'BASE_GENERADA', 'ERROR') THEN "estado" ELSE 'ERROR' END)::"EstadoEjecucionReciclaje";
ALTER TABLE "ejecuciones_reciclaje" ALTER COLUMN "estado" SET DEFAULT 'PREPARADA';
CREATE UNIQUE INDEX "ejecuciones_reciclaje_operacion_id_key" ON "ejecuciones_reciclaje"("operacion_id");
CREATE UNIQUE INDEX "ejecuciones_reciclaje_base_reciclada_id_key" ON "ejecuciones_reciclaje"("base_reciclada_id");
ALTER TABLE "ejecuciones_reciclaje"
  ADD CONSTRAINT "ejecuciones_reciclaje_base_reciclada_id_fkey"
  FOREIGN KEY ("base_reciclada_id") REFERENCES "bases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "gestiones_tipificacion" (
  "id" UUID NOT NULL,
  "archivo_id" UUID NOT NULL,
  "ejecucion_origen_id" UUID,
  "base_original_id" UUID NOT NULL,
  "numero_fila_origen" INTEGER NOT NULL,
  "movil_normalizado" TEXT NOT NULL,
  "fecha_gestion" DATE,
  "tipificacion_original" TEXT,
  "tipificacion_normalizada" TEXT,
  "venta_confirmada" BOOLEAN NOT NULL DEFAULT false,
  "evidencia_venta" TEXT,
  "metadatos" JSONB NOT NULL,
  "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "gestiones_tipificacion_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "gestiones_tipificacion_archivo_id_numero_fila_origen_key" ON "gestiones_tipificacion"("archivo_id", "numero_fila_origen");
CREATE INDEX "gestiones_tipificacion_base_original_id_movil_normalizado_idx" ON "gestiones_tipificacion"("base_original_id", "movil_normalizado");
CREATE INDEX "gestiones_tipificacion_base_original_id_fecha_gestion_idx" ON "gestiones_tipificacion"("base_original_id", "fecha_gestion");
ALTER TABLE "gestiones_tipificacion"
  ADD CONSTRAINT "gestiones_tipificacion_archivo_id_fkey" FOREIGN KEY ("archivo_id") REFERENCES "archivos_tipificaciones"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "gestiones_tipificacion_ejecucion_origen_id_fkey" FOREIGN KEY ("ejecucion_origen_id") REFERENCES "ejecuciones_reciclaje"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "gestiones_tipificacion_base_original_id_fkey" FOREIGN KEY ("base_original_id") REFERENCES "bases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "resultados_ejecuciones_reciclaje" (
  "id" UUID NOT NULL,
  "ejecucion_id" UUID NOT NULL,
  "registro_original_id" UUID NOT NULL,
  "gestion_ganadora_id" UUID,
  "estado" "EstadoResultadoReciclaje" NOT NULL,
  "motivo" TEXT NOT NULL,
  "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "resultados_ejecuciones_reciclaje_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "resultados_ejecuciones_reciclaje_ejecucion_id_registro_original_id_key" ON "resultados_ejecuciones_reciclaje"("ejecucion_id", "registro_original_id");
CREATE INDEX "resultados_ejecuciones_reciclaje_ejecucion_id_estado_idx" ON "resultados_ejecuciones_reciclaje"("ejecucion_id", "estado");
ALTER TABLE "resultados_ejecuciones_reciclaje"
  ADD CONSTRAINT "resultados_ejecuciones_reciclaje_ejecucion_id_fkey" FOREIGN KEY ("ejecucion_id") REFERENCES "ejecuciones_reciclaje"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "resultados_ejecuciones_reciclaje_registro_original_id_fkey" FOREIGN KEY ("registro_original_id") REFERENCES "registros"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "resultados_ejecuciones_reciclaje_gestion_ganadora_id_fkey" FOREIGN KEY ("gestion_ganadora_id") REFERENCES "gestiones_tipificacion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
