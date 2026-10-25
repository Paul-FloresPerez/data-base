-- DRAFT ONLY: do not apply until the plan in docs/plans/sozar-control-plane-migration.md
-- has been approved and tested on an isolated Neon branch. This migration is
-- additive: it does not alter or delete existing business tables or rows.

CREATE TYPE "EstadoConsultaHlr" AS ENUM ('PENDIENTE', 'EN_CURSO', 'EXITOSA', 'INCIERTA', 'FALLIDA');
CREATE TYPE "EstadoAprobacionHlr" AS ENUM ('PREPARADA', 'APROBADA', 'CANCELADA', 'AGOTADA');
CREATE TYPE "TipoEventoHlr" AS ENUM ('COLA_PREPARADA', 'RESERVA_CREADA', 'RESULTADO_CACHEADO', 'RESULTADO_RECIBIDO', 'RESULTADO_INCIERTO', 'RESULTADO_FALLIDO');

CREATE TABLE "resultados_hlr_reales" (
  "id" UUID NOT NULL,
  "proveedor" TEXT NOT NULL,
  "huella_movil" TEXT NOT NULL,
  "resultado" JSONB NOT NULL,
  "consultado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "vigente_hasta" TIMESTAMP(3) NOT NULL,
  "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "actualizado_en" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "resultados_hlr_reales_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "aprobaciones_hlr" (
  "id" UUID NOT NULL,
  "base_id" UUID NOT NULL,
  "usuario_id" UUID NOT NULL,
  "clave_operacion" TEXT NOT NULL,
  "estado" "EstadoAprobacionHlr" NOT NULL DEFAULT 'PREPARADA',
  "maximo_consultas" INTEGER NOT NULL,
  "presupuesto_max_centimos" INTEGER NOT NULL,
  "coste_maximo_por_consulta_centimos" INTEGER NOT NULL,
  "consultas_reservadas" INTEGER NOT NULL DEFAULT 0,
  "gasto_reservado_centimos" INTEGER NOT NULL DEFAULT 0,
  "aprobado_en" TIMESTAMP(3),
  "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "actualizado_en" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "aprobaciones_hlr_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "aprobaciones_hlr_maximo_consultas_check" CHECK ("maximo_consultas" >= 0),
  CONSTRAINT "aprobaciones_hlr_presupuesto_max_centimos_check" CHECK ("presupuesto_max_centimos" >= 0),
  CONSTRAINT "aprobaciones_hlr_coste_maximo_por_consulta_centimos_check" CHECK ("coste_maximo_por_consulta_centimos" >= 0),
  CONSTRAINT "aprobaciones_hlr_consultas_reservadas_check" CHECK ("consultas_reservadas" >= 0 AND "consultas_reservadas" <= "maximo_consultas"),
  CONSTRAINT "aprobaciones_hlr_gasto_reservado_centimos_check" CHECK ("gasto_reservado_centimos" >= 0 AND "gasto_reservado_centimos" <= "presupuesto_max_centimos"),
  CONSTRAINT "aprobaciones_hlr_no_aprobar_sin_coste_check" CHECK (("estado" <> 'APROBADA') OR ("coste_maximo_por_consulta_centimos" > 0))
);

CREATE TABLE "consultas_hlr" (
  "id" UUID NOT NULL,
  "proveedor" TEXT NOT NULL,
  "huella_movil" TEXT NOT NULL,
  "clave_idempotencia" TEXT NOT NULL,
  "estado" "EstadoConsultaHlr" NOT NULL DEFAULT 'PENDIENTE',
  "token_reserva" TEXT,
  "reservada_en" TIMESTAMP(3),
  "reserva_expira_en" TIMESTAMP(3),
  "intentos" INTEGER NOT NULL DEFAULT 0,
  "resultado_id" UUID,
  "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "actualizado_en" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "consultas_hlr_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "consultas_hlr_intentos_check" CHECK ("intentos" >= 0),
  CONSTRAINT "consultas_hlr_reserva_en_curso_check" CHECK (("estado" <> 'EN_CURSO') OR ("token_reserva" IS NOT NULL AND "reserva_expira_en" IS NOT NULL)),
  CONSTRAINT "consultas_hlr_incierta_sin_reserva_check" CHECK (("estado" <> 'INCIERTA') OR ("token_reserva" IS NULL))
);

CREATE TABLE "consulta_hlr_registros" (
  "consulta_id" UUID NOT NULL,
  "registro_id" UUID NOT NULL,
  "base_id" UUID NOT NULL,
  "aprobacion_id" UUID NOT NULL,
  "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "consulta_hlr_registros_pkey" PRIMARY KEY ("consulta_id", "registro_id")
);

CREATE TABLE "eventos_consulta_hlr" (
  "id" UUID NOT NULL,
  "consulta_id" UUID NOT NULL,
  "tipo" "TipoEventoHlr" NOT NULL,
  "clave_operacion" TEXT NOT NULL,
  "metadatos" JSONB NOT NULL,
  "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "eventos_consulta_hlr_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "resultados_hlr_reales_proveedor_huella_movil_key" ON "resultados_hlr_reales"("proveedor", "huella_movil");
CREATE INDEX "resultados_hlr_reales_proveedor_vigente_hasta_idx" ON "resultados_hlr_reales"("proveedor", "vigente_hasta");
CREATE UNIQUE INDEX "aprobaciones_hlr_clave_operacion_key" ON "aprobaciones_hlr"("clave_operacion");
CREATE INDEX "aprobaciones_hlr_base_id_estado_idx" ON "aprobaciones_hlr"("base_id", "estado");
CREATE INDEX "aprobaciones_hlr_usuario_id_idx" ON "aprobaciones_hlr"("usuario_id");
CREATE UNIQUE INDEX "consultas_hlr_clave_idempotencia_key" ON "consultas_hlr"("clave_idempotencia");
CREATE UNIQUE INDEX "consultas_hlr_token_reserva_key" ON "consultas_hlr"("token_reserva");
CREATE UNIQUE INDEX "consultas_hlr_proveedor_huella_movil_key" ON "consultas_hlr"("proveedor", "huella_movil");
CREATE INDEX "consultas_hlr_estado_reserva_expira_en_idx" ON "consultas_hlr"("estado", "reserva_expira_en");
CREATE INDEX "consulta_hlr_registros_base_id_idx" ON "consulta_hlr_registros"("base_id");
CREATE INDEX "consulta_hlr_registros_aprobacion_id_idx" ON "consulta_hlr_registros"("aprobacion_id");
CREATE UNIQUE INDEX "eventos_consulta_hlr_clave_operacion_key" ON "eventos_consulta_hlr"("clave_operacion");
CREATE INDEX "eventos_consulta_hlr_consulta_id_creado_en_idx" ON "eventos_consulta_hlr"("consulta_id", "creado_en");

ALTER TABLE "aprobaciones_hlr" ADD CONSTRAINT "aprobaciones_hlr_base_id_fkey" FOREIGN KEY ("base_id") REFERENCES "bases"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "aprobaciones_hlr" ADD CONSTRAINT "aprobaciones_hlr_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "consultas_hlr" ADD CONSTRAINT "consultas_hlr_resultado_id_fkey" FOREIGN KEY ("resultado_id") REFERENCES "resultados_hlr_reales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "consulta_hlr_registros" ADD CONSTRAINT "consulta_hlr_registros_consulta_id_fkey" FOREIGN KEY ("consulta_id") REFERENCES "consultas_hlr"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "consulta_hlr_registros" ADD CONSTRAINT "consulta_hlr_registros_registro_id_fkey" FOREIGN KEY ("registro_id") REFERENCES "registros"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "consulta_hlr_registros" ADD CONSTRAINT "consulta_hlr_registros_base_id_fkey" FOREIGN KEY ("base_id") REFERENCES "bases"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "consulta_hlr_registros" ADD CONSTRAINT "consulta_hlr_registros_aprobacion_id_fkey" FOREIGN KEY ("aprobacion_id") REFERENCES "aprobaciones_hlr"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "eventos_consulta_hlr" ADD CONSTRAINT "eventos_consulta_hlr_consulta_id_fkey" FOREIGN KEY ("consulta_id") REFERENCES "consultas_hlr"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- These guards cover invariants involving independent foreign keys: a record
-- and its approval belong to the same base, and a cache row belongs to the
-- same provider/mobile fingerprint as the query that references it.
CREATE FUNCTION "validar_destino_consulta_hlr"() RETURNS TRIGGER AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "registros" WHERE "id" = NEW."registro_id" AND "base_id" = NEW."base_id"
  ) THEN
    RAISE EXCEPTION 'El registro HLR no pertenece a la base indicada';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM "aprobaciones_hlr" WHERE "id" = NEW."aprobacion_id" AND "base_id" = NEW."base_id"
  ) THEN
    RAISE EXCEPTION 'La aprobación HLR no pertenece a la base indicada';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "consulta_hlr_registros_base_consistente"
BEFORE INSERT OR UPDATE OF "registro_id", "base_id", "aprobacion_id" ON "consulta_hlr_registros"
FOR EACH ROW EXECUTE FUNCTION "validar_destino_consulta_hlr"();

CREATE FUNCTION "validar_resultado_consulta_hlr"() RETURNS TRIGGER AS $$
BEGIN
  IF NEW."resultado_id" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "resultados_hlr_reales"
    WHERE "id" = NEW."resultado_id"
      AND "proveedor" = NEW."proveedor"
      AND "huella_movil" = NEW."huella_movil"
  ) THEN
    RAISE EXCEPTION 'El resultado HLR no corresponde a la consulta';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "consultas_hlr_resultado_consistente"
BEFORE INSERT OR UPDATE OF "resultado_id", "proveedor", "huella_movil" ON "consultas_hlr"
FOR EACH ROW EXECUTE FUNCTION "validar_resultado_consulta_hlr"();
