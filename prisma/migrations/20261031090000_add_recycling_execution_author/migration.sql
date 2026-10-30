-- Additive attribution for recycling executions. Existing immutable history is retained.
ALTER TABLE "ejecuciones_reciclaje"
  ADD COLUMN "usuario_id" UUID;

CREATE INDEX "ejecuciones_reciclaje_usuario_id_creado_en_idx"
  ON "ejecuciones_reciclaje"("usuario_id", "creado_en");

ALTER TABLE "ejecuciones_reciclaje"
  ADD CONSTRAINT "ejecuciones_reciclaje_usuario_id_fkey"
  FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
