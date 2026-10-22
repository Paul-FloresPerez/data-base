import nextEnv from "@next/env";
import { neon } from "@neondatabase/serverless";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const connectionString = process.env.DATABASE_URL_UNPOOLED;

if (!connectionString) {
  throw new Error("DATABASE_URL_UNPOOLED is required to verify the migration target.");
}

const sql = neon(connectionString);
const [target] = (await sql`
  SELECT
    (SELECT count(*)::int
     FROM information_schema.tables
     WHERE table_schema = 'public' AND table_type = 'BASE TABLE') AS application_table_count,
    to_regclass('public._prisma_migrations') IS NOT NULL AS prisma_migrations_exists
`) as {
  application_table_count: number;
  prisma_migrations_exists: boolean;
}[];

const isNewDatabase =
  target.application_table_count === 0 && !target.prisma_migrations_exists;

console.log(
  JSON.stringify({
    targetVerified: isNewDatabase,
    publicTableCount: target.application_table_count,
    prismaMigrationsExists: target.prisma_migrations_exists,
  })
);

if (!isNewDatabase) {
  process.exitCode = 1;
}
