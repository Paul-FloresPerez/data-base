-- RG-3: immutable global recycling execution snapshots. All changes are additive.
CREATE TYPE "EstadoEjecucionReciclajeGlobal" AS ENUM ('PREPARADA', 'EVALUANDO', 'EVALUADA', 'ERROR');
CREATE TYPE "DecisionReciclajeGlobal" AS ENUM ('ELEGIBLE', 'EXCLUIDO', 'REVISION', 'BLOQUEADO');

ALTER TABLE "filas_archivos_crm" ADD COLUMN "fecha_gestion" DATE,
ADD COLUMN "tipificacion_original" TEXT,
ADD COLUMN "tipificacion_normalizada" TEXT,
ADD COLUMN "venta_confirmada" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "evidencia_venta" TEXT;

CREATE TABLE "ejecuciones_reciclajes_globales" (
  "id" UUID NOT NULL,
  "operacion_id" TEXT NOT NULL,
  "usuario_id" UUID NOT NULL,
  "fecha_efectiva" DATE NOT NULL,
  "estado" "EstadoEjecucionReciclajeGlobal" NOT NULL DEFAULT 'PREPARADA',
  "version_reglas" TEXT NOT NULL,
  "criterios" JSONB NOT NULL,
  "resumen" JSONB,
  "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "evaluado_en" TIMESTAMP(3),
  CONSTRAINT "ejecuciones_reciclajes_globales_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "ejecuciones_reciclajes_globales_archivos" (
  "id" UUID NOT NULL,
  "ejecucion_id" UUID NOT NULL,
  "archivo_crm_id" UUID NOT NULL,
  "importacion_id" TEXT NOT NULL,
  "nombre_archivo" TEXT NOT NULL,
  "metadatos" JSONB NOT NULL,
  "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ejecuciones_reciclajes_globales_archivos_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "ejecuciones_reciclajes_globales_bases" (
  "id" UUID NOT NULL,
  "ejecucion_id" UUID NOT NULL,
  "base_original_id" UUID NOT NULL,
  "codigo_base" TEXT NOT NULL,
  "resumen" JSONB NOT NULL,
  "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ejecuciones_reciclajes_globales_bases_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "decisiones_ejecuciones_reciclajes_globales" (
  "id" UUID NOT NULL,
  "ejecucion_id" UUID NOT NULL,
  "movil_normalizado" TEXT NOT NULL,
  "decision" "DecisionReciclajeGlobal" NOT NULL,
  "motivo" TEXT NOT NULL,
  "fuentes" JSONB NOT NULL,
  "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "decisiones_ejecuciones_reciclajes_globales_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ejecuciones_reciclajes_globales_operacion_id_key" ON "ejecuciones_reciclajes_globales"("operacion_id");
CREATE INDEX "ejecuciones_reciclajes_globales_usuario_id_creado_en_idx" ON "ejecuciones_reciclajes_globales"("usuario_id", "creado_en");
CREATE INDEX "ejecuciones_reciclajes_globales_estado_creado_en_idx" ON "ejecuciones_reciclajes_globales"("estado", "creado_en");
CREATE UNIQUE INDEX "ejecuciones_reciclajes_globales_archivos_ejecucion_id_archivo_crm_id_key" ON "ejecuciones_reciclajes_globales_archivos"("ejecucion_id", "archivo_crm_id");
CREATE INDEX "ejecuciones_reciclajes_globales_archivos_archivo_crm_id_idx" ON "ejecuciones_reciclajes_globales_archivos"("archivo_crm_id");
CREATE UNIQUE INDEX "ejecuciones_reciclajes_globales_bases_ejecucion_id_base_original_id_key" ON "ejecuciones_reciclajes_globales_bases"("ejecucion_id", "base_original_id");
CREATE INDEX "ejecuciones_reciclajes_globales_bases_base_original_id_idx" ON "ejecuciones_reciclajes_globales_bases"("base_original_id");
CREATE UNIQUE INDEX "decisiones_ejecuciones_reciclajes_globales_ejecucion_id_movil_normalizado_key" ON "decisiones_ejecuciones_reciclajes_globales"("ejecucion_id", "movil_normalizado");
CREATE INDEX "decisiones_ejecuciones_reciclajes_globales_ejecucion_id_decision_idx" ON "decisiones_ejecuciones_reciclajes_globales"("ejecucion_id", "decision");

ALTER TABLE "ejecuciones_reciclajes_globales" ADD CONSTRAINT "ejecuciones_reciclajes_globales_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ejecuciones_reciclajes_globales_archivos" ADD CONSTRAINT "ejecuciones_reciclajes_globales_archivos_ejecucion_id_fkey" FOREIGN KEY ("ejecucion_id") REFERENCES "ejecuciones_reciclajes_globales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ejecuciones_reciclajes_globales_archivos" ADD CONSTRAINT "ejecuciones_reciclajes_globales_archivos_archivo_crm_id_fkey" FOREIGN KEY ("archivo_crm_id") REFERENCES "archivos_crm_canonicos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ejecuciones_reciclajes_globales_bases" ADD CONSTRAINT "ejecuciones_reciclajes_globales_bases_ejecucion_id_fkey" FOREIGN KEY ("ejecucion_id") REFERENCES "ejecuciones_reciclajes_globales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ejecuciones_reciclajes_globales_bases" ADD CONSTRAINT "ejecuciones_reciclajes_globales_bases_base_original_id_fkey" FOREIGN KEY ("base_original_id") REFERENCES "bases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "decisiones_ejecuciones_reciclajes_globales" ADD CONSTRAINT "decisiones_ejecuciones_reciclajes_globales_ejecucion_id_fkey" FOREIGN KEY ("ejecucion_id") REFERENCES "ejecuciones_reciclajes_globales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
