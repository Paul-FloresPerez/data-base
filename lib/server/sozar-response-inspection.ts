import "server-only";

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const RESPONSE_FORMAT = "sozar-encrypted-response-v1" as const;
const MAX_RESPONSE_BYTES = 128 * 1024;
const MAX_INSPECTION_DEPTH = 6;
const MAX_INSPECTION_KEYS = 50;
const BASE64URL_256_BIT_SECRET = /^[A-Za-z0-9_-]{43}$/;

export interface EncryptedSozarResponse {
  format: typeof RESPONSE_FORMAT;
  algorithm: "aes-256-gcm";
  ciphertext: string;
  iv: string;
  tag: string;
  capturedAt: string;
}

export type SozarResponseShape =
  | "null"
  | "boolean"
  | "number"
  | "string"
  | { array: SozarResponseShape[] | "depth_limited" }
  | { object: Record<string, SozarResponseShape> | "depth_limited" };

export class SozarResponseInspectionError extends Error {}

function decodeEncryptionKey(encodedKey: string): Buffer {
  if (!BASE64URL_256_BIT_SECRET.test(encodedKey)) {
    throw new SozarResponseInspectionError("La clave privada de inspección Sozar debe ser base64url sin relleno y de 32 bytes.");
  }
  const key = Buffer.from(encodedKey, "base64url");
  if (key.length !== 32) {
    throw new SozarResponseInspectionError("La clave privada de inspección Sozar debe tener 32 bytes codificados en base64url.");
  }
  return key;
}

/** Reads a server-only key for a future reviewed persistence endpoint. */
export function getSozarResponseEncryptionKeyFromEnvironment(): string {
  const encodedKey = process.env.SOZAR_RESPONSE_ENCRYPTION_KEY;
  if (!encodedKey?.trim()) {
    throw new SozarResponseInspectionError("Falta la clave privada de cifrado de respuestas Sozar.");
  }
  decodeEncryptionKey(encodedKey);
  return encodedKey;
}

function serializeResponse(response: unknown): Buffer {
  let serialized: string;
  try {
    serialized = JSON.stringify(response);
  } catch {
    throw new SozarResponseInspectionError("La respuesta de Sozar no puede serializarse de forma segura.");
  }
  if (serialized === undefined) throw new SozarResponseInspectionError("La respuesta de Sozar no contiene JSON inspeccionable.");
  const bytes = Buffer.from(serialized, "utf8");
  if (bytes.length > MAX_RESPONSE_BYTES) {
    throw new SozarResponseInspectionError("La respuesta de Sozar supera el límite seguro de inspección.");
  }
  return bytes;
}

/** Encrypts the original JSON before it is ever persisted in ResultadoHlrReal.resultado. */
export function encryptSozarResponseForInspection(response: unknown, encodedKey: string, capturedAt = new Date().toISOString()): EncryptedSozarResponse {
  const key = decodeEncryptionKey(encodedKey);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(serializeResponse(response)), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    format: RESPONSE_FORMAT,
    algorithm: "aes-256-gcm",
    ciphertext: ciphertext.toString("base64url"),
    iv: iv.toString("base64url"),
    tag: tag.toString("base64url"),
    capturedAt,
  };
}

/** Server-only recovery for a reviewed mapper. Never return this value to a client or audit log. */
export function decryptSozarResponseForMapping(encrypted: EncryptedSozarResponse, encodedKey: string): unknown {
  if (encrypted.format !== RESPONSE_FORMAT || encrypted.algorithm !== "aes-256-gcm") {
    throw new SozarResponseInspectionError("El formato almacenado de respuesta Sozar no es compatible.");
  }
  try {
    const decipher = createDecipheriv("aes-256-gcm", decodeEncryptionKey(encodedKey), Buffer.from(encrypted.iv, "base64url"));
    decipher.setAuthTag(Buffer.from(encrypted.tag, "base64url"));
    const plaintext = Buffer.concat([decipher.update(Buffer.from(encrypted.ciphertext, "base64url")), decipher.final()]);
    return JSON.parse(plaintext.toString("utf8"));
  } catch (error) {
    if (error instanceof SozarResponseInspectionError) throw error;
    throw new SozarResponseInspectionError("No se pudo descifrar la respuesta Sozar almacenada.");
  }
}

/** Produces an inspectable schema only: values, telephones and credentials stay encrypted. */
export function describeSozarResponseShape(value: unknown, depth = 0): SozarResponseShape {
  if (value === null) return "null";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") return "number";
  if (typeof value === "string") return "string";
  if (depth >= MAX_INSPECTION_DEPTH) return Array.isArray(value) ? { array: "depth_limited" } : { object: "depth_limited" };
  if (Array.isArray(value)) return { array: value.slice(0, MAX_INSPECTION_KEYS).map((entry) => describeSozarResponseShape(entry, depth + 1)) };
  if (typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>).sort().slice(0, MAX_INSPECTION_KEYS);
    return { object: Object.fromEntries(keys.map((key) => [key, describeSozarResponseShape((value as Record<string, unknown>)[key], depth + 1)])) };
  }
  throw new SozarResponseInspectionError("La respuesta de Sozar contiene un tipo no compatible.");
}
