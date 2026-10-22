import nextEnv from "@next/env";

const { loadEnvConfig } = nextEnv;

loadEnvConfig(process.cwd());

const { prisma } = await import("../lib/server/prisma.ts");

type SafeError = {
  name: string;
  code?: string;
  type?: string;
  message?: string;
  stack?: string;
  cause?: SafeError;
  errors?: SafeError[];
};

function redact(value: string) {
  return value
    .replace(/postgres(?:ql)?:\/\/[^\s'"`]+/gi, "[redacted connection string]")
    .replace(
      /\bep-[a-z0-9-]+(?:-pooler)?\.c-\d+\.[a-z0-9-]+\.aws\.neon\.tech\b/gi,
      "[redacted Neon host]"
    )
    .replace(/(password=)[^&\s]+/gi, "$1[redacted]");
}

function toSafeError(error: unknown, depth = 0): SafeError {
  if (!error || typeof error !== "object" || depth > 4) {
    return { name: typeof error };
  }

  const source = error as {
    name?: unknown;
    code?: unknown;
    type?: unknown;
    message?: unknown;
    stack?: unknown;
    cause?: unknown;
    errors?: unknown;
    constructor?: { name?: unknown };
  };
  const result: SafeError = {
    name:
      typeof source.name === "string"
        ? source.name
        : typeof source.constructor?.name === "string"
          ? source.constructor.name
          : "Error",
  };

  if (typeof source.code === "string" || typeof source.code === "number") {
    result.code = String(source.code);
  }

  if (typeof source.type === "string") {
    result.type = source.type;
  }

  if (typeof source.message === "string" && source.message) {
    result.message = redact(source.message);
  }

  if (typeof source.stack === "string" && source.stack) {
    result.stack = redact(source.stack);
  }

  if (source.cause) {
    result.cause = toSafeError(source.cause, depth + 1);
  }

  if (Array.isArray(source.errors)) {
    result.errors = source.errors.map((nested) =>
      toSafeError(nested, depth + 1)
    );
  }

  return result;
}

try {
  await prisma.$queryRaw`SELECT 1`;
  console.log("Database connection succeeded.");
} catch (error) {
  console.error("Database connection failed.");
  console.error(JSON.stringify(toSafeError(error), null, 2));
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
