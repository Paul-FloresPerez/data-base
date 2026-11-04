-- Additive, reversible-by-data archive markers. No source row, commercial
-- history, reservation or CRM management is removed by this migration.
ALTER TYPE "AccionAuditoria" ADD VALUE IF NOT EXISTS 'BASE_ARCHIVADA';
ALTER TYPE "AccionAuditoria" ADD VALUE IF NOT EXISTS 'BASE_RESTAURADA';

ALTER TABLE "bases"
  ADD COLUMN "archivada_en" TIMESTAMP(3),
  ADD COLUMN "archivada_por_usuario_id" UUID,
  ADD COLUMN "motivo_archivado" TEXT;

ALTER TABLE "bases"
  ADD CONSTRAINT "bases_archivada_por_usuario_id_fkey"
  FOREIGN KEY ("archivada_por_usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "bases_archivada_en_idx" ON "bases"("archivada_en");
