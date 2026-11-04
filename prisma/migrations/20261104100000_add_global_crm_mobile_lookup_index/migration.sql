-- RG-2: global reconciliation looks up a bounded mobile batch across all
-- original bases. The existing (base_id, movil_normalizado) index cannot
-- efficiently serve that cross-base predicate.
CREATE INDEX "registros_movil_normalizado_idx" ON "registros"("movil_normalizado");
