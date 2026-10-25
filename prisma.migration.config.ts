import { defineConfig, env } from "prisma/config";

const target = process.env.PRISMA_MIGRATION_TARGET;
const guard = process.env.PRISMA_MIGRATION_GUARD;

if (target !== "test" && target !== "production") {
  throw new Error("A migration target of test or production is required.");
}

if (guard !== `validated:${target}`) {
  throw new Error("Safe migration preflight has not completed for the selected target.");
}

/**
 * This config deliberately does not load .env.local. The launcher provides this
 * variable only after it has verified the selected database identity.
 */
export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: env("PRISMA_MIGRATION_URL"),
  },
});
