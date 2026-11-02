-- Additive durable work orchestration. No existing business row is changed.
CREATE TYPE "EstadoTrabajoProcesamiento" AS ENUM (
  'PENDIENTE', 'EN_PROCESO', 'RECUPERABLE', 'COMPLETADO', 'FALLIDO', 'CANCELADO'
);

CREATE TYPE "TipoTrabajoProcesamiento" AS ENUM (
  'IMPORTACION', 'CONCILIACION', 'RECICLAJE', 'EXPORTACION'
);

CREATE TABLE "trabajos_procesamiento" (
  "id" UUID NOT NULL,
  "operacion_id" TEXT NOT NULL,
  "tipo" "TipoTrabajoProcesamiento" NOT NULL,
  "estado" "EstadoTrabajoProcesamiento" NOT NULL DEFAULT 'PENDIENTE',
  "usuario_id" UUID NOT NULL,
  "base_id" UUID,
  "total_bloques" INTEGER NOT NULL DEFAULT 0,
  "bloques_completados" INTEGER NOT NULL DEFAULT 0,
  "bloques_fallidos" INTEGER NOT NULL DEFAULT 0,
  "progreso_porcentaje" INTEGER NOT NULL DEFAULT 0,
  "max_intentos" INTEGER NOT NULL DEFAULT 3,
  "checkpoint" JSONB,
  "metadatos" JSONB NOT NULL,
  "codigo_error" TEXT,
  "mensaje_error" TEXT,
  "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "iniciado_en" TIMESTAMP(3),
  "finalizado_en" TIMESTAMP(3),
  "actualizado_en" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "trabajos_procesamiento_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "trabajos_procesamiento_total_bloques_check" CHECK ("total_bloques" >= 0),
  CONSTRAINT "trabajos_procesamiento_bloques_completados_check" CHECK ("bloques_completados" >= 0),
  CONSTRAINT "trabajos_procesamiento_bloques_fallidos_check" CHECK ("bloques_fallidos" >= 0),
  CONSTRAINT "trabajos_procesamiento_progreso_porcentaje_check" CHECK ("progreso_porcentaje" BETWEEN 0 AND 100),
  CONSTRAINT "trabajos_procesamiento_max_intentos_check" CHECK ("max_intentos" BETWEEN 1 AND 20)
);

CREATE TABLE "bloques_trabajos_procesamiento" (
  "id" UUID NOT NULL,
  "trabajo_id" UUID NOT NULL,
  "numero_bloque" INTEGER NOT NULL,
  "estado" "EstadoTrabajoProcesamiento" NOT NULL DEFAULT 'PENDIENTE',
  "intentos" INTEGER NOT NULL DEFAULT 0,
  "worker_id" TEXT,
  "reclamado_en" TIMESTAMP(3),
  "lease_hasta" TIMESTAMP(3),
  "checkpoint" JSONB,
  "resumen" JSONB,
  "codigo_error" TEXT,
  "mensaje_error" TEXT,
  "completado_en" TIMESTAMP(3),
  "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "actualizado_en" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "bloques_trabajos_procesamiento_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "bloques_trabajos_procesamiento_numero_bloque_check" CHECK ("numero_bloque" >= 0),
  CONSTRAINT "bloques_trabajos_procesamiento_intentos_check" CHECK ("intentos" >= 0)
);

CREATE TABLE "archivos_procesamiento" (
  "id" UUID NOT NULL,
  "trabajo_id" UUID NOT NULL,
  "nombre_original" TEXT NOT NULL,
  "tipo_contenido" TEXT,
  "tamano_bytes" INTEGER NOT NULL,
  "huella_contenido" TEXT NOT NULL,
  "referencia_privada" TEXT NOT NULL,
  "metadatos" JSONB NOT NULL,
  "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "archivos_procesamiento_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "archivos_procesamiento_tamano_bytes_check" CHECK ("tamano_bytes" >= 0)
);

CREATE UNIQUE INDEX "trabajos_procesamiento_operacion_id_key" ON "trabajos_procesamiento"("operacion_id");
CREATE INDEX "trabajos_procesamiento_usuario_id_creado_en_idx" ON "trabajos_procesamiento"("usuario_id", "creado_en");
CREATE INDEX "trabajos_procesamiento_base_id_creado_en_idx" ON "trabajos_procesamiento"("base_id", "creado_en");
CREATE INDEX "trabajos_procesamiento_estado_creado_en_idx" ON "trabajos_procesamiento"("estado", "creado_en");
CREATE UNIQUE INDEX "bloques_trabajos_procesamiento_trabajo_id_numero_bloque_key" ON "bloques_trabajos_procesamiento"("trabajo_id", "numero_bloque");
CREATE INDEX "bloques_trabajos_procesamiento_trabajo_id_estado_numero_bloque_idx" ON "bloques_trabajos_procesamiento"("trabajo_id", "estado", "numero_bloque");
CREATE INDEX "bloques_trabajos_procesamiento_estado_lease_hasta_idx" ON "bloques_trabajos_procesamiento"("estado", "lease_hasta");
CREATE UNIQUE INDEX "archivos_procesamiento_trabajo_id_huella_contenido_key" ON "archivos_procesamiento"("trabajo_id", "huella_contenido");
CREATE UNIQUE INDEX "archivos_procesamiento_referencia_privada_key" ON "archivos_procesamiento"("referencia_privada");
CREATE INDEX "archivos_procesamiento_trabajo_id_creado_en_idx" ON "archivos_procesamiento"("trabajo_id", "creado_en");

ALTER TABLE "trabajos_procesamiento" ADD CONSTRAINT "trabajos_procesamiento_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "trabajos_procesamiento" ADD CONSTRAINT "trabajos_procesamiento_base_id_fkey" FOREIGN KEY ("base_id") REFERENCES "bases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "bloques_trabajos_procesamiento" ADD CONSTRAINT "bloques_trabajos_procesamiento_trabajo_id_fkey" FOREIGN KEY ("trabajo_id") REFERENCES "trabajos_procesamiento"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "archivos_procesamiento" ADD CONSTRAINT "archivos_procesamiento_trabajo_id_fkey" FOREIGN KEY ("trabajo_id") REFERENCES "trabajos_procesamiento"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
