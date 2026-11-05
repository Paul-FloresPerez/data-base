import nextEnv from "@next/env";
import { Client } from "pg";

nextEnv.loadEnvConfig(process.cwd());
const connectionString = process.env.PRISMA_MIGRATION_TEST_URL;
const expectedBranch = process.env.PRISMA_MIGRATION_TEST_BRANCH_ID;
if (!connectionString || !expectedBranch) throw new Error("La conexión segura de Test no está configurada.");
const client = new Client({ connectionString });
try {
  await client.connect();
  const identity = await client.query<{ branch_id: string | null }>("SELECT current_setting('neon.branch_id', true) AS branch_id");
  if (identity.rows[0]?.branch_id !== expectedBranch) throw new Error("La identidad de Test no coincide.");
  const fixtures = await client.query<{ users: string; jobs: string; bases: string; records: string }>(`
    SELECT
      (SELECT count(*)::text FROM usuarios WHERE username LIKE 'synthetic-incremental-%') AS users,
      (SELECT count(*)::text FROM trabajos_procesamiento t JOIN usuarios u ON u.id = t.usuario_id WHERE u.username LIKE 'synthetic-incremental-%') AS jobs,
      (SELECT count(*)::text FROM bases b JOIN trabajos_procesamiento t ON t.base_id = b.id JOIN usuarios u ON u.id = t.usuario_id WHERE u.username LIKE 'synthetic-incremental-%') AS bases,
      (SELECT count(*)::text FROM registros r JOIN bases b ON b.id = r.base_id JOIN trabajos_procesamiento t ON t.base_id = b.id JOIN usuarios u ON u.id = t.usuario_id WHERE u.username LIKE 'synthetic-incremental-%') AS records
  `);
  console.log(JSON.stringify({ target: "test", branchId: expectedBranch, fixtures: fixtures.rows[0] }));
} finally { await client.end(); }
