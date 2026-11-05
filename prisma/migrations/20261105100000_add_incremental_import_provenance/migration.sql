-- Additive provenance for rows ingested by durable processing jobs. The
-- existing technical source-row identity remains untouched for compatibility.
ALTER TABLE "registros"
  ADD COLUMN "archivo_procesamiento_id" UUID,
  ADD COLUMN "hoja_origen" TEXT,
  ADD COLUMN "numero_fila_archivo" INTEGER;

ALTER TABLE "registros"
  ADD CONSTRAINT "registros_archivo_procesamiento_id_fkey"
  FOREIGN KEY ("archivo_procesamiento_id") REFERENCES "archivos_procesamiento"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "registros_archivo_procesamiento_id_numero_fila_archivo_idx"
  ON "registros"("archivo_procesamiento_id", "numero_fila_archivo");
