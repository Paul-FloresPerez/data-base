-- CreateEnum
CREATE TYPE "EstadoBase" AS ENUM ('LISTA_PARA_LIMPIAR', 'LISTA_PARA_ENRIQUECER', 'LISTA_PARA_DISTRIBUIR');

-- CreateEnum
CREATE TYPE "TipificacionRegistro" AS ENUM ('PENDIENTE', 'VALIDO', 'TELEFONO_VACIO', 'TELEFONO_FIJO', 'TELEFONO_INVALIDO', 'NOMBRE_VACIO', 'TELEFONO_DUPLICADO');

-- CreateEnum
CREATE TYPE "Campana" AS ENUM ('YOIGO', 'VODAFONE');

-- CreateTable
CREATE TABLE "bases" (
    "id" UUID NOT NULL,
    "nombre_original" TEXT NOT NULL,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMP(3) NOT NULL,
    "estado" "EstadoBase" NOT NULL DEFAULT 'LISTA_PARA_LIMPIAR',
    "cantidad_importados" INTEGER NOT NULL DEFAULT 0,
    "cantidad_validos" INTEGER NOT NULL DEFAULT 0,
    "cantidad_excluidos" INTEGER NOT NULL DEFAULT 0,
    "metadatos" JSONB NOT NULL,

    CONSTRAINT "bases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "registros" (
    "id" UUID NOT NULL,
    "base_id" UUID NOT NULL,
    "numero_fila_original" INTEGER NOT NULL,
    "movil_normalizado" TEXT,
    "documento" TEXT,
    "nombre" TEXT,
    "operador_actual" TEXT,
    "operador_original" TEXT,
    "fecha_portabilidad" DATE,
    "tipificacion" "TipificacionRegistro" NOT NULL DEFAULT 'PENDIENTE',
    "datos_originales" JSONB NOT NULL,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "registros_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lotes" (
    "id" UUID NOT NULL,
    "base_id" UUID NOT NULL,
    "campana" "Campana" NOT NULL,
    "numero_lote" INTEGER NOT NULL,
    "cantidad_registros" INTEGER NOT NULL DEFAULT 0,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lote_registros" (
    "lote_id" UUID NOT NULL,
    "registro_id" UUID NOT NULL,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lote_registros_pkey" PRIMARY KEY ("lote_id","registro_id")
);

-- CreateIndex
CREATE INDEX "bases_estado_idx" ON "bases"("estado");

-- CreateIndex
CREATE INDEX "registros_base_id_idx" ON "registros"("base_id");

-- CreateIndex
CREATE INDEX "registros_base_id_movil_normalizado_idx" ON "registros"("base_id", "movil_normalizado");

-- CreateIndex
CREATE INDEX "registros_base_id_tipificacion_idx" ON "registros"("base_id", "tipificacion");

-- CreateIndex
CREATE UNIQUE INDEX "registros_base_id_numero_fila_original_key" ON "registros"("base_id", "numero_fila_original");

-- CreateIndex
CREATE INDEX "lotes_base_id_idx" ON "lotes"("base_id");

-- CreateIndex
CREATE UNIQUE INDEX "lotes_base_id_campana_numero_lote_key" ON "lotes"("base_id", "campana", "numero_lote");

-- CreateIndex
CREATE INDEX "lote_registros_registro_id_idx" ON "lote_registros"("registro_id");

-- AddForeignKey
ALTER TABLE "registros" ADD CONSTRAINT "registros_base_id_fkey" FOREIGN KEY ("base_id") REFERENCES "bases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lotes" ADD CONSTRAINT "lotes_base_id_fkey" FOREIGN KEY ("base_id") REFERENCES "bases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lote_registros" ADD CONSTRAINT "lote_registros_lote_id_fkey" FOREIGN KEY ("lote_id") REFERENCES "lotes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lote_registros" ADD CONSTRAINT "lote_registros_registro_id_fkey" FOREIGN KEY ("registro_id") REFERENCES "registros"("id") ON DELETE CASCADE ON UPDATE CASCADE;
