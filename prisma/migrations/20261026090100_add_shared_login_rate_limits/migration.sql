-- DRAFT ONLY: do not apply until tested on an isolated PostgreSQL/Neon branch.
-- This is additive and intentionally stores an HMAC fingerprint, not username,
-- IP address, password or other personal data.
CREATE TABLE "limites_intentos_login" (
  "clave" TEXT NOT NULL,
  "intentos" INTEGER NOT NULL DEFAULT 0,
  "ventana_iniciada_en" TIMESTAMP(3) NOT NULL,
  "bloqueado_hasta" TIMESTAMP(3),
  "actualizado_en" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "limites_intentos_login_pkey" PRIMARY KEY ("clave"),
  CONSTRAINT "limites_intentos_login_intentos_check" CHECK ("intentos" >= 0)
);

CREATE INDEX "limites_intentos_login_bloqueado_hasta_idx" ON "limites_intentos_login"("bloqueado_hasta");
