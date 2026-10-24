import JSZip from "jszip";

export interface RecyclingImportLimits {
  maxCompressedBytes: number;
  maxUncompressedBytes: number;
  maxFiles: number;
  maxWorkbookBytes: number;
}

export const defaultRecyclingImportLimits: RecyclingImportLimits = {
  maxCompressedBytes: 250 * 1024 * 1024,
  maxUncompressedBytes: 750 * 1024 * 1024,
  maxFiles: 500,
  maxWorkbookBytes: 30 * 1024 * 1024,
};

export interface ArchiveWorkbook {
  fileName: string;
  zipName: string;
  internalPath: string;
  bytes: ArrayBuffer;
  fingerprint: string;
}

export interface ArchiveIssue {
  fileName: string;
  reason: string;
}

export interface ArchiveExtraction {
  workbooks: ArchiveWorkbook[];
  rejected: ArchiveIssue[];
}

const temporaryOrHiddenSegment = /(^|[/\\])(?:~\$|\.)/;

export function isSafeArchivePath(path: string): boolean {
  return Boolean(path)
    && !path.includes("\0")
    && !/^[\\/]/.test(path)
    && !path.split(/[\\/]/).some((segment) => segment === ".." || segment === "");
}

export function isSupportedWorkbookPath(path: string): boolean {
  return /\.xlsx$/i.test(path) && !temporaryOrHiddenSegment.test(path);
}

export async function fingerprintBytes(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function extractArchiveWorkbooks(
  zipName: string,
  bytes: ArrayBuffer,
  limits: RecyclingImportLimits = defaultRecyclingImportLimits,
): Promise<ArchiveExtraction> {
  const rejected: ArchiveIssue[] = [];
  if (bytes.byteLength > limits.maxCompressedBytes) {
    return { workbooks: [], rejected: [{ fileName: zipName, reason: "El ZIP supera el límite comprimido configurado." }] };
  }

  let archive: JSZip;
  try {
    archive = await JSZip.loadAsync(bytes, { createFolders: false });
  } catch {
    return { workbooks: [], rejected: [{ fileName: zipName, reason: "El ZIP está corrupto o no se puede abrir." }] };
  }

  const entries = Object.values(archive.files).filter((entry) => !entry.dir);
  const workbooks: ArchiveWorkbook[] = [];
  let uncompressedBytes = 0;
  for (const entry of entries) {
    const path = entry.name;
    if (!isSafeArchivePath(path)) {
      rejected.push({ fileName: `${zipName}: ${path}`, reason: "Ruta interna insegura." });
      continue;
    }
    if (!isSupportedWorkbookPath(path)) continue;
    if (workbooks.length >= limits.maxFiles) {
      rejected.push({ fileName: `${zipName}: ${path}`, reason: "Se alcanzó el límite de archivos Excel por operación." });
      continue;
    }
    const declaredSize = (entry as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize;
    if (declaredSize && (declaredSize > limits.maxWorkbookBytes || uncompressedBytes + declaredSize > limits.maxUncompressedBytes)) {
      rejected.push({ fileName: `${zipName}: ${path}`, reason: "El Excel excede los límites de seguridad del ZIP." });
      continue;
    }
    const workbookBytes = await entry.async("arraybuffer");
    if (workbookBytes.byteLength > limits.maxWorkbookBytes || uncompressedBytes + workbookBytes.byteLength > limits.maxUncompressedBytes) {
      rejected.push({ fileName: `${zipName}: ${path}`, reason: "El Excel excede los límites de seguridad del ZIP." });
      continue;
    }
    uncompressedBytes += workbookBytes.byteLength;
    workbooks.push({
      fileName: path.split(/[\\/]/).at(-1) ?? path,
      zipName,
      internalPath: path,
      bytes: workbookBytes,
      fingerprint: await fingerprintBytes(workbookBytes),
    });
  }
  if (!workbooks.length && !rejected.length) rejected.push({ fileName: zipName, reason: "El ZIP no contiene archivos XLSX admitidos." });
  return { workbooks, rejected };
}
