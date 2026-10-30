-- Additive base-history catalogue. Existing business rows stay in place.
CREATE TYPE "TipoBase" AS ENUM ('ORIGINAL', 'RECICLADA');

ALTER TABLE "bases"
  ADD COLUMN "codigo" TEXT,
  ADD COLUMN "nombre_descriptivo" TEXT,
  ADD COLUMN "fecha_recepcion" DATE,
  ADD COLUMN "tipo" "TipoBase" NOT NULL DEFAULT 'ORIGINAL',
  ADD COLUMN "base_original_id" UUID;

-- Old versions stored the editable label in nombre_original. Preserve it as
-- the descriptive name while recovering the source filename from metadata.
UPDATE "bases"
SET "nombre_descriptivo" = "nombre_original",
    "nombre_original" = COALESCE(NULLIF("metadatos"->>'originalFileName', ''), "nombre_original"),
    "tipo" = CASE WHEN "metadatos"->>'kind' = 'RECICLADA' THEN 'RECICLADA'::"TipoBase" ELSE 'ORIGINAL'::"TipoBase" END;

-- Existing recycled bases intentionally remain unlinked because their source
-- was never stored. Original bases use NULL as their root marker: a base's
-- immutable id is the root identifier and no self-referential FK is needed.

WITH ranked AS (
  SELECT "id",
         to_char("creado_en" AT TIME ZONE 'UTC', 'YYYY-MM') AS periodo,
         row_number() OVER (PARTITION BY to_char("creado_en" AT TIME ZONE 'UTC', 'YYYY-MM') ORDER BY "creado_en", "id") AS numero
  FROM "bases"
)
UPDATE "bases" AS base
SET "codigo" = 'BAS-' || ranked.periodo || '-' || lpad(ranked.numero::text, 4, '0')
FROM ranked
WHERE base."id" = ranked."id";

ALTER TABLE "bases"
  ALTER COLUMN "codigo" SET NOT NULL,
  ALTER COLUMN "nombre_descriptivo" SET NOT NULL;

CREATE UNIQUE INDEX "bases_codigo_key" ON "bases"("codigo");
CREATE INDEX "bases_tipo_fecha_recepcion_idx" ON "bases"("tipo", "fecha_recepcion");
CREATE INDEX "bases_base_original_id_idx" ON "bases"("base_original_id");

ALTER TABLE "bases"
  ADD CONSTRAINT "bases_base_original_id_fkey"
  FOREIGN KEY ("base_original_id") REFERENCES "bases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "secuencias_codigos_base" (
  "periodo" TEXT NOT NULL,
  "ultimo_numero" INTEGER NOT NULL,
  CONSTRAINT "secuencias_codigos_base_pkey" PRIMARY KEY ("periodo"),
  CONSTRAINT "secuencias_codigos_base_ultimo_numero_check" CHECK ("ultimo_numero" > 0)
);

INSERT INTO "secuencias_codigos_base" ("periodo", "ultimo_numero")
SELECT split_part("codigo", '-', 2) || '-' || split_part("codigo", '-', 3), max(split_part("codigo", '-', 4)::integer)
FROM "bases"
GROUP BY 1;

ALTER TABLE "lotes" ADD COLUMN "base_original_id" UUID;

UPDATE "lotes" AS lote
SET "base_original_id" = base."base_original_id"
FROM "bases" AS base
WHERE base."id" = lote."base_id";

CREATE INDEX "lotes_base_original_id_idx" ON "lotes"("base_original_id");
ALTER TABLE "lotes"
  ADD CONSTRAINT "lotes_base_original_id_fkey"
  FOREIGN KEY ("base_original_id") REFERENCES "bases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "archivos_tipificaciones" (
  "id" UUID NOT NULL,
  "importacion_id" TEXT NOT NULL,
  "base_id" UUID NOT NULL,
  "nombre_archivo" TEXT NOT NULL,
  "importado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resumen" JSONB NOT NULL,
  CONSTRAINT "archivos_tipificaciones_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "archivos_tipificaciones_importacion_id_key" ON "archivos_tipificaciones"("importacion_id");
CREATE INDEX "archivos_tipificaciones_base_id_importado_en_idx" ON "archivos_tipificaciones"("base_id", "importado_en");
ALTER TABLE "archivos_tipificaciones"
  ADD CONSTRAINT "archivos_tipificaciones_base_id_fkey"
  FOREIGN KEY ("base_id") REFERENCES "bases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "ejecuciones_reciclaje" (
  "id" UUID NOT NULL,
  "base_original_id" UUID NOT NULL,
  "estado" TEXT NOT NULL DEFAULT 'PREPARADA',
  "metadatos" JSONB NOT NULL,
  "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ejecuciones_reciclaje_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ejecuciones_reciclaje_base_original_id_creado_en_idx" ON "ejecuciones_reciclaje"("base_original_id", "creado_en");
ALTER TABLE "ejecuciones_reciclaje"
  ADD CONSTRAINT "ejecuciones_reciclaje_base_original_id_fkey"
  FOREIGN KEY ("base_original_id") REFERENCES "bases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
