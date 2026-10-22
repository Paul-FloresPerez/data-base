import nextEnv from "@next/env";
import { hashPassword } from "../lib/server/password-hash.ts";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

async function readPassword() {
  if (!process.stdin.isTTY) {
    throw new Error("Ejecuta este comando en una terminal interactiva.");
  }

  return new Promise<string>((resolve, reject) => {
    let password = "";
    const input = process.stdin;

    const cleanup = () => {
      input.setRawMode(false);
      input.pause();
      input.removeListener("data", onData);
    };

    const onData = (chunk: Buffer | string) => {
      for (const character of chunk.toString()) {
        if (character === "\r" || character === "\n") {
          cleanup();
          process.stdout.write("\n");
          resolve(password);
          return;
        }

        if (character === "\u0003") {
          cleanup();
          reject(new Error("Aprovisionamiento cancelado."));
          return;
        }

        if (character === "\u0008" || character === "\u007f") {
          password = password.slice(0, -1);
          continue;
        }

        password += character;
      }
    };

    process.stdout.write("Contraseña para el administrador: ");
    input.setRawMode(true);
    input.resume();
    input.on("data", onData);
  });
}

const password = await readPassword();
const passwordHash = await hashPassword(password);
const { prisma } = await import("../lib/server/prisma.ts");

try {
  await prisma.usuario.upsert({
    where: { username: "midas" },
    update: { passwordHash, activo: true },
    create: { username: "midas", passwordHash, activo: true },
  });

  console.log("Administrador aprovisionado correctamente.");
} finally {
  await prisma.$disconnect();
}
