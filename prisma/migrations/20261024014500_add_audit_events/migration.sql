-- Additive audit trail. Existing bases, records and lots are not modified.
CREATE TYPE "AccionAuditoria" AS ENUM ('BASE_CREADA', 'BASE_RECICLADA', 'ENRIQUECIMIENTO_APLICADO', 'CONFIGURACION_CAMPANA', 'LOTES_CREADOS', 'EXPORTACION_GENERADA', 'DESCARGA_INICIADA', 'ENTREGA_CONFIRMADA');
CREATE TYPE "EstadoExportacion" AS ENUM ('GENERADO', 'DESCARGA_INICIADA', 'ENTREGADO_CONFIRMADO');

CREATE TABLE "eventos_auditoria" (
  "id" UUID NOT NULL,
  "operacion_id" TEXT NOT NULL,
  "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "accion" "AccionAuditoria" NOT NULL,
  "usuario_id" UUID NOT NULL,
  "base_id" UUID NOT NULL,
  "lote_id" UUID,
  "campana" "Campana",
  "cantidad" INTEGER,
  "metadatos" JSONB NOT NULL,
  CONSTRAINT "eventos_auditoria_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "registros_exportacion" (
  "id" UUID NOT NULL,
  "operacion_id" TEXT NOT NULL,
  "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "usuario_id" UUID NOT NULL,
  "base_id" UUID NOT NULL,
  "lote_id" UUID,
  "numero_lote" INTEGER,
  "campana" "Campana",
  "tipo" TEXT NOT NULL,
  "estado" "EstadoExportacion" NOT NULL DEFAULT 'GENERADO',
  "cantidad" INTEGER NOT NULL,
  "filtros" JSONB NOT NULL,
  "metadatos" JSONB NOT NULL,
  "destinatario" TEXT,
  "descarga_iniciada_en" TIMESTAMP(3),
  "entrega_confirmada_en" TIMESTAMP(3),
  CONSTRAINT "registros_exportacion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "eventos_auditoria_operacion_id_key" ON "eventos_auditoria"("operacion_id");
CREATE INDEX "eventos_auditoria_base_id_creado_en_idx" ON "eventos_auditoria"("base_id", "creado_en");
CREATE INDEX "eventos_auditoria_usuario_id_creado_en_idx" ON "eventos_auditoria"("usuario_id", "creado_en");
CREATE INDEX "eventos_auditoria_campana_creado_en_idx" ON "eventos_auditoria"("campana", "creado_en");
CREATE INDEX "eventos_auditoria_accion_creado_en_idx" ON "eventos_auditoria"("accion", "creado_en");
CREATE UNIQUE INDEX "registros_exportacion_operacion_id_key" ON "registros_exportacion"("operacion_id");
CREATE INDEX "registros_exportacion_base_id_creado_en_idx" ON "registros_exportacion"("base_id", "creado_en");
CREATE INDEX "registros_exportacion_campana_creado_en_idx" ON "registros_exportacion"("campana", "creado_en");
CREATE INDEX "registros_exportacion_estado_creado_en_idx" ON "registros_exportacion"("estado", "creado_en");

ALTER TABLE "eventos_auditoria" ADD CONSTRAINT "eventos_auditoria_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "eventos_auditoria" ADD CONSTRAINT "eventos_auditoria_base_id_fkey" FOREIGN KEY ("base_id") REFERENCES "bases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "registros_exportacion" ADD CONSTRAINT "registros_exportacion_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "registros_exportacion" ADD CONSTRAINT "registros_exportacion_base_id_fkey" FOREIGN KEY ("base_id") REFERENCES "bases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
