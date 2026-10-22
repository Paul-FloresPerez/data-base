import nextEnv from "@next/env";
import { defineConfig, env } from "prisma/config";

const { loadEnvConfig } = nextEnv;

loadEnvConfig(process.cwd());

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    // The Prisma CLI must bypass Neon pooling for schema operations.
    url: env("DATABASE_URL_UNPOOLED"),
  },
});
