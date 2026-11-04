-- Additive RG-4 linkage and final revalidation outcome ledger.
ALTER TABLE "ejecuciones_reciclajes_globales"
  ADD COLUMN "base_reciclada_id" UUID,
  ADD COLUMN "generado_en" TIMESTAMP(3);

ALTER TABLE "ejecuciones_reciclajes_globales"
  ADD CONSTRAINT "ejecuciones_reciclajes_globales_base_reciclada_id_fkey"
  FOREIGN KEY ("base_reciclada_id") REFERENCES "bases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "ejecuciones_reciclajes_globales_base_reciclada_id_key"
  ON "ejecuciones_reciclajes_globales"("base_reciclada_id");

CREATE TYPE "EstadoResultadoGeneracionReciclajeGlobal" AS ENUM ('INCLUIDO', 'EXCLUIDO_CAMBIO');

CREATE TABLE "resultados_generaciones_reciclajes_globales" (
  "id" UUID NOT NULL,
  "ejecucion_id" UUID NOT NULL,
  "movil_normalizado" TEXT NOT NULL,
  "estado" "EstadoResultadoGeneracionReciclajeGlobal" NOT NULL,
  "motivo" TEXT NOT NULL,
  "procedencias" JSONB NOT NULL,
  "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "resultados_generaciones_reciclajes_globales_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "resultados_generaciones_reciclajes_globales_ejecucion_id_fkey"
    FOREIGN KEY ("ejecucion_id") REFERENCES "ejecuciones_reciclajes_globales"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "resultados_generaciones_reciclajes_globales_ejecucion_id_movil_normalizado_key"
  ON "resultados_generaciones_reciclajes_globales"("ejecucion_id", "movil_normalizado");
CREATE INDEX "resultados_generaciones_reciclajes_globales_ejecucion_id_estado_idx"
  ON "resultados_generaciones_reciclajes_globales"("ejecucion_id", "estado");
