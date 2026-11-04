-- RG-1: additive canonical CRM-file infrastructure. Existing historical
-- ArchivoTipificaciones and GestionTipificacion rows are intentionally untouched.
CREATE TABLE "archivos_crm_canonicos" (
  "id" UUID NOT NULL,
  "importacion_id" TEXT NOT NULL,
  "huella_contenido" TEXT,
  "nombre_archivo" TEXT NOT NULL,
  "archivo_tipificaciones_legacy_id" UUID,
  "metadatos" JSONB NOT NULL,
  "importado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "archivos_crm_canonicos_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "archivos_crm_bases" (
  "id" UUID NOT NULL,
  "archivo_crm_id" UUID NOT NULL,
  "base_original_id" UUID NOT NULL,
  "resumen_conciliacion" JSONB,
  "metadatos" JSONB NOT NULL,
  "asociado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "archivos_crm_bases_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "filas_archivos_crm" (
  "id" UUID NOT NULL,
  "archivo_crm_id" UUID NOT NULL,
  "hoja_origen" TEXT NOT NULL,
  "numero_fila_origen" INTEGER NOT NULL,
  "movil_normalizado" TEXT,
  "datos_originales" JSONB NOT NULL,
  "metadatos" JSONB NOT NULL,
  "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "filas_archivos_crm_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "archivos_crm_canonicos_importacion_id_key" ON "archivos_crm_canonicos"("importacion_id");
CREATE UNIQUE INDEX "archivos_crm_canonicos_huella_contenido_key" ON "archivos_crm_canonicos"("huella_contenido");
CREATE UNIQUE INDEX "archivos_crm_canonicos_archivo_tipificaciones_legacy_id_key" ON "archivos_crm_canonicos"("archivo_tipificaciones_legacy_id");
CREATE INDEX "archivos_crm_canonicos_importado_en_idx" ON "archivos_crm_canonicos"("importado_en");
CREATE UNIQUE INDEX "archivos_crm_bases_archivo_crm_id_base_original_id_key" ON "archivos_crm_bases"("archivo_crm_id", "base_original_id");
CREATE INDEX "archivos_crm_bases_base_original_id_asociado_en_idx" ON "archivos_crm_bases"("base_original_id", "asociado_en");
CREATE UNIQUE INDEX "filas_archivos_crm_archivo_crm_id_hoja_origen_numero_fila_origen_key" ON "filas_archivos_crm"("archivo_crm_id", "hoja_origen", "numero_fila_origen");
CREATE INDEX "filas_archivos_crm_movil_normalizado_idx" ON "filas_archivos_crm"("movil_normalizado");
CREATE INDEX "filas_archivos_crm_archivo_crm_id_movil_normalizado_idx" ON "filas_archivos_crm"("archivo_crm_id", "movil_normalizado");

ALTER TABLE "archivos_crm_canonicos" ADD CONSTRAINT "archivos_crm_canonicos_archivo_tipificaciones_legacy_id_fkey" FOREIGN KEY ("archivo_tipificaciones_legacy_id") REFERENCES "archivos_tipificaciones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "archivos_crm_bases" ADD CONSTRAINT "archivos_crm_bases_archivo_crm_id_fkey" FOREIGN KEY ("archivo_crm_id") REFERENCES "archivos_crm_canonicos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "archivos_crm_bases" ADD CONSTRAINT "archivos_crm_bases_base_original_id_fkey" FOREIGN KEY ("base_original_id") REFERENCES "bases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "filas_archivos_crm" ADD CONSTRAINT "filas_archivos_crm_archivo_crm_id_fkey" FOREIGN KEY ("archivo_crm_id") REFERENCES "archivos_crm_canonicos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
