import assert from "node:assert/strict";
import test from "node:test";
import { assertMigrationIdentity, createMigrationPlan } from "../lib/migration/safe-migration.ts";

const testEnvironment = {
  PRISMA_MIGRATION_TARGET: "test",
  PRISMA_MIGRATION_CONFIRM: "MIGRATE_TEST",
  PRISMA_MIGRATION_TEST_URL: "postgresql://ep-test.neon.tech/app?sslmode=require",
  PRISMA_MIGRATION_TEST_BRANCH_ID: "br-test-expected",
};

test("bloquea una selección sin destino explícito", () => {
  assert.throws(
    () => createMigrationPlan({ PRISMA_MIGRATION_CONFIRM: "MIGRATE_TEST" }),
    /PRISMA_MIGRATION_TARGET/,
  );
});

test("no usa DATABASE_URL ni DATABASE_URL_UNPOOLED como fallback", () => {
  assert.throws(
    () => createMigrationPlan({
      PRISMA_MIGRATION_TARGET: "test",
      PRISMA_MIGRATION_CONFIRM: "MIGRATE_TEST",
      DATABASE_URL: "postgresql://production.example.invalid/app",
      DATABASE_URL_UNPOOLED: "postgresql://production.example.invalid/app",
      PRISMA_MIGRATION_TEST_BRANCH_ID: "br-test-expected",
    }),
    /PRISMA_MIGRATION_TEST_URL is required/,
  );
});

test("bloquea una URL de migración malformada", () => {
  assert.throws(
    () => createMigrationPlan({ ...testEnvironment, PRISMA_MIGRATION_TEST_URL: "not-a-url" }),
    /valid PostgreSQL connection URL/,
  );
});

test("bloquea Test cuando se configura accidentalmente con la URL dedicada de Production", () => {
  assert.throws(
    () => createMigrationPlan({
      ...testEnvironment,
      PRISMA_MIGRATION_PRODUCTION_URL: testEnvironment.PRISMA_MIGRATION_TEST_URL,
    }),
    /must not equal the production migration URL/,
  );
});

test("bloquea Backup como destino", () => {
  assert.throws(
    () => createMigrationPlan({ ...testEnvironment, PRISMA_MIGRATION_TARGET: "backup" }),
    /Backup is read-only/,
  );
});

test("bloquea un branch_id distinto antes de Prisma", () => {
  const plan = createMigrationPlan(testEnvironment);
  assert.throws(
    () => assertMigrationIdentity(plan, { branchId: "br-production", databaseName: "app" }),
    /Branch identity does not match/,
  );
});

test("acepta Test únicamente con URL dedicada, confirmación y branch_id correcto", () => {
  const plan = createMigrationPlan(testEnvironment);
  assert.doesNotThrow(() => {
    assertMigrationIdentity(plan, { branchId: "br-test-expected", databaseName: "app" });
  });
});

test("para PostgreSQL propio exige y comprueba una identidad de base explícita", () => {
  const environment = {
    PRISMA_MIGRATION_TARGET: "test",
    PRISMA_MIGRATION_CONFIRM: "MIGRATE_TEST",
    PRISMA_MIGRATION_TEST_URL: "postgresql://db.internal.example/app",
    PRISMA_MIGRATION_TEST_DATABASE_NAME: "app_test",
  };
  const plan = createMigrationPlan(environment);
  assert.doesNotThrow(() => {
    assertMigrationIdentity(plan, { branchId: null, databaseName: "app_test" });
  });
  assert.throws(
    () => assertMigrationIdentity(plan, { branchId: null, databaseName: "app_production" }),
    /Database identity does not match/,
  );
});
