import { lookup } from "node:dns/promises";
import { connect } from "node:tls";

import nextEnv from "@next/env";
import { neon } from "@neondatabase/serverless";

const { loadEnvConfig } = nextEnv;
const environment = loadEnvConfig(process.cwd());

type SafeError = {
  name: string;
  code?: string;
  message?: string;
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
    message?: unknown;
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

  if (typeof source.message === "string" && source.message) {
    result.message = redact(source.message);
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

async function testTls(hostname: string, port: number) {
  return new Promise<void>((resolve, reject) => {
    const socket = connect({
      host: hostname,
      port,
      servername: hostname,
      rejectUnauthorized: true,
    });

    const timeout = setTimeout(() => {
      socket.destroy(new Error("TLS connection timed out"));
    }, 10_000);

    socket.once("secureConnect", () => {
      clearTimeout(timeout);
      socket.end();
      resolve();
    });
    socket.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

async function testWebSocket(hostname: string) {
  return new Promise<void>((resolve, reject) => {
    const socket = new WebSocket(`wss://${hostname}/v2`);
    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error("WebSocket connection timed out"));
    }, 10_000);

    socket.addEventListener("open", () => {
      clearTimeout(timeout);
      socket.close();
      resolve();
    });
    socket.addEventListener("error", (event) => {
      clearTimeout(timeout);
      reject(event);
    });
  });
}

async function runCheck(name: string, check: () => Promise<void>) {
  try {
    await check();
    return { name, ok: true };
  } catch (error) {
    return { name, ok: false, error: toSafeError(error) };
  }
}

function getDatabaseUrl(name: "DATABASE_URL" | "DATABASE_URL_UNPOOLED") {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is not set.`);
  }

  return new URL(value);
}

const pooled = getDatabaseUrl("DATABASE_URL");
const direct = getDatabaseUrl("DATABASE_URL_UNPOOLED");
const sql = neon(process.env.DATABASE_URL!);
const directSql = neon(process.env.DATABASE_URL_UNPOOLED!);

const checks = await Promise.all([
  runCheck("dns-pooled", async () => {
    await lookup(pooled.hostname, { all: true });
  }),
  runCheck("dns-direct", async () => {
    await lookup(direct.hostname, { all: true });
  }),
  runCheck("tls-pooled", () => testTls(pooled.hostname, Number(pooled.port || 5432))),
  runCheck("tls-direct", () => testTls(direct.hostname, Number(direct.port || 5432))),
  runCheck("websocket-pooled", () => testWebSocket(pooled.hostname)),
  runCheck("websocket-direct", () => testWebSocket(direct.hostname)),
  runCheck("select-1-pooled-http", async () => {
    await sql`SELECT 1`;
  }),
  runCheck("select-1-direct-http", async () => {
    await directSql`SELECT 1`;
  }),
]);

console.log(
  JSON.stringify(
    {
      environment: {
        loadedEnvLocal: environment.loadedEnvFiles.some(
          (file) => file.path === ".env.local"
        ),
        pooledUrlPresent: Boolean(process.env.DATABASE_URL),
        directUrlPresent: Boolean(process.env.DATABASE_URL_UNPOOLED),
        pooledHostIsPooler: pooled.hostname.includes("-pooler."),
        directHostIsPooler: direct.hostname.includes("-pooler."),
      },
      runtime: {
        node: process.version,
        globalWebSocketAvailable: typeof WebSocket !== "undefined",
      },
      checks,
    },
    null,
    2
  )
);

if (checks.some((check) => !check.ok)) {
  process.exitCode = 1;
}
