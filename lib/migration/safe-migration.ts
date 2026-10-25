export type MigrationTarget = "test" | "production";

type Environment = Record<string, string | undefined>;

export type MigrationPlan = {
  target: MigrationTarget;
  connectionString: string;
  expectedBranchId: string | null;
  expectedDatabaseName: string | null;
};

export type MigrationIdentity = {
  branchId: string | null;
  databaseName: string;
};

const TARGETS: Record<MigrationTarget, {
  urlVariable: string;
  branchVariable: string;
  databaseVariable: string;
  confirmation: string;
}> = {
  test: {
    urlVariable: "PRISMA_MIGRATION_TEST_URL",
    branchVariable: "PRISMA_MIGRATION_TEST_BRANCH_ID",
    databaseVariable: "PRISMA_MIGRATION_TEST_DATABASE_NAME",
    confirmation: "MIGRATE_TEST",
  },
  production: {
    urlVariable: "PRISMA_MIGRATION_PRODUCTION_URL",
    branchVariable: "PRISMA_MIGRATION_PRODUCTION_BRANCH_ID",
    databaseVariable: "PRISMA_MIGRATION_PRODUCTION_DATABASE_NAME",
    confirmation: "MIGRATE_PRODUCTION",
  },
};

function required(environment: Environment, variable: string) {
  const value = environment[variable]?.trim();
  if (!value) {
    throw new Error(`${variable} is required for a safe migration.`);
  }
  return value;
}

function validatePostgresUrl(value: string, variable: string) {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
      throw new Error("unsupported protocol");
    }
  } catch {
    throw new Error(`${variable} must be a valid PostgreSQL connection URL.`);
  }
}

function isNeonUrl(value: string) {
  return new URL(value).hostname.endsWith(".neon.tech");
}

function parseTarget(value: string | undefined): MigrationTarget {
  if (value === "test" || value === "production") return value;
  if (value === "backup") {
    throw new Error("Backup is read-only and can never be a migration target.");
  }
  throw new Error("PRISMA_MIGRATION_TARGET must be exactly test or production.");
}

/**
 * Creates a plan without consulting DATABASE_URL or DATABASE_URL_UNPOOLED.
 * A caller must still verify the database identity before launching Prisma.
 */
export function createMigrationPlan(environment: Environment): MigrationPlan {
  const target = parseTarget(environment.PRISMA_MIGRATION_TARGET);
  const config = TARGETS[target];
  const connectionString = required(environment, config.urlVariable);

  validatePostgresUrl(connectionString, config.urlVariable);

  const expectedBranchId = environment[config.branchVariable]?.trim() || null;
  const expectedDatabaseName = environment[config.databaseVariable]?.trim() || null;
  if (isNeonUrl(connectionString) && !expectedBranchId) {
    throw new Error(`${config.branchVariable} is required for a Neon migration.`);
  }
  if (!isNeonUrl(connectionString) && !expectedDatabaseName) {
    throw new Error(`${config.databaseVariable} is required for a non-Neon migration.`);
  }

  const otherTarget: MigrationTarget = target === "test" ? "production" : "test";
  const otherUrl = environment[TARGETS[otherTarget].urlVariable]?.trim();
  if (otherUrl && otherUrl === connectionString) {
    throw new Error(`The ${target} migration URL must not equal the ${otherTarget} migration URL.`);
  }

  if (environment.PRISMA_MIGRATION_CONFIRM !== config.confirmation) {
    throw new Error(`PRISMA_MIGRATION_CONFIRM must be ${config.confirmation} for ${target}.`);
  }

  return { target, connectionString, expectedBranchId, expectedDatabaseName };
}

export function assertMigrationIdentity(plan: MigrationPlan, identity: MigrationIdentity) {
  if (plan.expectedBranchId && !identity.branchId) {
    throw new Error(`Unable to read the branch identity for ${plan.target}; migration blocked.`);
  }
  if (plan.expectedBranchId && identity.branchId !== plan.expectedBranchId) {
    throw new Error(`Branch identity does not match the selected ${plan.target} target; migration blocked.`);
  }
  if (plan.expectedDatabaseName && identity.databaseName !== plan.expectedDatabaseName) {
    throw new Error(`Database identity does not match the selected ${plan.target} target; migration blocked.`);
  }
}

export function migrationConfirmationFor(target: MigrationTarget) {
  return TARGETS[target].confirmation;
}
