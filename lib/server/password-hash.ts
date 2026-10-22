import "server-only";

import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";

const SCRYPT_COST = 16_384;
const SCRYPT_BLOCK_SIZE = 8;
const SCRYPT_PARALLELIZATION = 1;
const SCRYPT_KEY_LENGTH = 64;
const SCRYPT_MAX_MEMORY = 64 * 1024 * 1024;

type PasswordHash = {
  cost: number;
  blockSize: number;
  parallelization: number;
  salt: Buffer;
  hash: Buffer;
};

function deriveScryptKey(
  password: string,
  salt: Buffer,
  keyLength: number,
  options: { N: number; r: number; p: number; maxmem: number },
) {
  return new Promise<Buffer>((resolve, reject) => {
    scryptCallback(password, salt, keyLength, options, (error, derivedKey) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(derivedKey);
    });
  });
}

function parsePasswordHash(value: string): PasswordHash | null {
  const parts = value.split("$");

  if (parts.length !== 7 || parts[1] !== "scrypt") {
    return null;
  }

  const [cost, blockSize, parallelization] = parts.slice(2, 5).map(Number);

  if (
    !Number.isInteger(cost) ||
    !Number.isInteger(blockSize) ||
    !Number.isInteger(parallelization) ||
    cost < SCRYPT_COST ||
    blockSize < SCRYPT_BLOCK_SIZE ||
    parallelization < SCRYPT_PARALLELIZATION
  ) {
    return null;
  }

  try {
    const salt = Buffer.from(parts[5], "base64url");
    const hash = Buffer.from(parts[6], "base64url");

    return salt.length >= 16 && hash.length >= 32
      ? { cost, blockSize, parallelization, salt, hash }
      : null;
  } catch {
    return null;
  }
}

export async function hashPassword(password: string) {
  if (password.length < 12) {
    throw new Error("La contraseña debe tener al menos 12 caracteres.");
  }

  const salt = randomBytes(16);
  const hash = await deriveScryptKey(password, salt, SCRYPT_KEY_LENGTH, {
    N: SCRYPT_COST,
    r: SCRYPT_BLOCK_SIZE,
    p: SCRYPT_PARALLELIZATION,
    maxmem: SCRYPT_MAX_MEMORY,
  });

  return `$scrypt$${SCRYPT_COST}$${SCRYPT_BLOCK_SIZE}$${SCRYPT_PARALLELIZATION}$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

export async function verifyPasswordHash(password: string, value: string) {
  const parsedHash = parsePasswordHash(value);

  if (!parsedHash) {
    return false;
  }

  const candidateHash = await deriveScryptKey(password, parsedHash.salt, parsedHash.hash.length, {
    N: parsedHash.cost,
    r: parsedHash.blockSize,
    p: parsedHash.parallelization,
    maxmem: SCRYPT_MAX_MEMORY,
  });

  return timingSafeEqual(candidateHash, parsedHash.hash);
}
