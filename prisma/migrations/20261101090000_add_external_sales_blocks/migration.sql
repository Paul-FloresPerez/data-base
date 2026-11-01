-- Append-only external sale history. No existing row or relationship changes.
CREATE TYPE "EstadoVentaExterna" AS ENUM ('CONFIRMADA', 'AMBIGUA', 'NO_CONFIRMADA', 'CORREGIDA');

CREATE TABLE "importaciones_ventas" (
  "id" UUID NOT NULL,
  "importacion_id" TEXT NOT NULL,
  "huella_contenido" TEXT NOT NULL,
  "usuario_id" UUID NOT NULL,
  "nombre_archivo" TEXT NOT NULL,
  "periodo_declarado" TEXT,
  "resumen" JSONB NOT NULL,
  "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "importaciones_ventas_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ventas_externas" (
  "id" UUID NOT NULL,
  "importacion_id" UUID NOT NULL,
  "numero_fila_origen" INTEGER NOT NULL,
  "movil_normalizado" TEXT,
  "fecha_venta" DATE,
  "estado" "EstadoVentaExterna" NOT NULL,
  "estado_original" TEXT,
  "asesor" TEXT,
  "campana" TEXT,
  "resultado_conciliacion" TEXT NOT NULL,
  "metadatos" JSONB NOT NULL,
  "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ventas_externas_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "importaciones_ventas_importacion_id_key" ON "importaciones_ventas"("importacion_id");
CREATE UNIQUE INDEX "importaciones_ventas_huella_contenido_key" ON "importaciones_ventas"("huella_contenido");
CREATE INDEX "importaciones_ventas_creado_en_idx" ON "importaciones_ventas"("creado_en");
CREATE INDEX "importaciones_ventas_usuario_id_creado_en_idx" ON "importaciones_ventas"("usuario_id", "creado_en");
CREATE UNIQUE INDEX "ventas_externas_importacion_id_numero_fila_origen_key" ON "ventas_externas"("importacion_id", "numero_fila_origen");
CREATE INDEX "ventas_externas_movil_normalizado_estado_idx" ON "ventas_externas"("movil_normalizado", "estado");
CREATE INDEX "ventas_externas_fecha_venta_idx" ON "ventas_externas"("fecha_venta");

ALTER TABLE "importaciones_ventas" ADD CONSTRAINT "importaciones_ventas_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ventas_externas" ADD CONSTRAINT "ventas_externas_importacion_id_fkey" FOREIGN KEY ("importacion_id") REFERENCES "importaciones_ventas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
