import nextEnv from "@next/env";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const { prisma } = await import("../lib/server/prisma.ts");

try {
  const user = await prisma.usuario.findUnique({
    where: { username: "midas" },
    select: { activo: true },
  });
  const verified = Boolean(user?.activo);

  console.log(JSON.stringify({ administratorVerified: verified }));

  if (!verified) {
    process.exitCode = 1;
  }
} finally {
  await prisma.$disconnect();
}
