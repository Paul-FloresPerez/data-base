import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { assertIncomingRecordIntegrity } from "@/lib/server/base-integrity";
import { claimProcessingBlock, completeProcessingBlock, getProcessingJob, ProcessingJobError } from "@/lib/server/processing-jobs-storage";
import { detectColumnMapping } from "@/lib/excel/import-excel";
import { normalizeSpanishMobile, spanishMobileExclusionReason, isNullLikeName } from "@/lib/excel/cleaning";
import type { ColumnMapping, ExclusionReason } from "@/lib/excel/types";
import type { StoredMetadata, StoredRecord, StoredTipification } from "@/lib/persistence/workspace-persistence";
import { prisma } from "@/lib/server/prisma";
import { nextBaseCode } from "@/lib/server/base-code";

const DEFAULT_BLOCK_SIZE = 1_000;
const MAX_BLOCK_SIZE = 10_000;

type ImportFilePlan = { id: string; originalName: string; totalRows: number; firstSourceRow: number; globalFirstRow: number };
type ImportPlanMetadata = { version: 1; kind: "INCREMENTAL_CSV"; blockSize: number; sources: ImportFilePlan[] };
export type IncrementalCsvSource = { originalName: string; contentHash: string; privateReference: string; bytes: number; totalRows: number; headers: string[]; firstSourceRow?: number; contentType?: string | null };
export type IncrementalCsvRow = { sourceRow: number; cells: string[] };

function requireUuid(value: string, label: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw new Error(`${label} no es válido.`);
}

function requireBlockSize(value: number) {
  if (!Number.isInteger(value) || value < 1 || value > MAX_BLOCK_SIZE) throw new Error("El tamaño de bloque no es válido.");
  return value;
}

function metadataFor(headers: string[], mapping: ColumnMapping, originalName: string): StoredMetadata {
  return {
    version: 1, completed: false, revision: null, originalFileName: originalName, columns: headers, columnMapping: mapping,
    enrichmentColumns: null, enrichmentMode: "preserve", campaignFilters: {}, distribution: { batchSize: 100, selectedCampaigns: [] }, enrichmentSource: null, kind: "ORIGINAL",
  };
}

function tipificationFor(row: { mobile: string; name: string }, mapping: ColumnMapping): { normalizedMobile: string | null; reason: ExclusionReason | null; tipification: StoredTipification } {
  const reason = spanishMobileExclusionReason(row.mobile);
  if (reason === "telefono_vacio") return { normalizedMobile: null, reason, tipification: "TELEFONO_VACIO" };
  if (reason === "telefono_fijo") return { normalizedMobile: null, reason, tipification: "TELEFONO_FIJO" };
  if (reason === "telefono_invalido") return { normalizedMobile: null, reason, tipification: "TELEFONO_INVALIDO" };
  if (mapping.nombre !== undefined && isNullLikeName(row.name)) return { normalizedMobile: null, reason: "nombre_vacio", tipification: "NOMBRE_VACIO" };
  const normalizedMobile = normalizeSpanishMobile(row.mobile);
  return normalizedMobile ? { normalizedMobile, reason: null, tipification: "VALIDO" } : { normalizedMobile: null, reason: "telefono_invalido", tipification: "TELEFONO_INVALIDO" };
}

function planFrom(metadata: unknown): ImportPlanMetadata {
  if (!metadata || typeof metadata !== "object") throw new Error("El trabajo de importación no contiene un plan válido.");
  const candidate = metadata as Partial<ImportPlanMetadata>;
  if (candidate.version !== 1 || candidate.kind !== "INCREMENTAL_CSV" || !Number.isInteger(candidate.blockSize) || !Array.isArray(candidate.sources)) throw new Error("El trabajo de importación no contiene un plan válido.");
  return candidate as ImportPlanMetadata;
}

function sourceForBlock(plan: ImportPlanMetadata, blockNumber: number) {
  let remaining = blockNumber;
  for (const source of plan.sources) {
    const blockCount = Math.ceil(source.totalRows / plan.blockSize);
    if (remaining < blockCount) {
      const offset = remaining * plan.blockSize;
      return { source, firstRow: source.firstSourceRow + offset, rowCount: Math.min(plan.blockSize, source.totalRows - offset), globalFirstRow: source.globalFirstRow + offset };
    }
    remaining -= blockCount;
  }
  throw new Error("El bloque no pertenece al plan de importación.");
}

export async function createIncrementalCsvImport(input: { operationId: string; baseId: string; userId: string; name: string; receivedAt?: Date | null; sources: readonly IncrementalCsvSource[]; blockSize?: number }) {
  requireUuid(input.operationId, "La operación"); requireUuid(input.baseId, "La base"); requireUuid(input.userId, "El usuario");
  const blockSize = requireBlockSize(input.blockSize ?? DEFAULT_BLOCK_SIZE);
  if (!input.name.trim() || input.name.trim().length > 180 || !input.sources.length) throw new Error("La importación incremental no es válida.");
  const headers = input.sources[0]?.headers;
  if (!headers?.length || input.sources.some((source) => JSON.stringify(source.headers) !== JSON.stringify(headers) || !Number.isInteger(source.totalRows) || source.totalRows < 0 || !/^[a-f0-9]{64}$/i.test(source.contentHash) || !source.privateReference.trim())) throw new Error("Las fuentes CSV no comparten una estructura o metadatos válidos.");
  const mapping = detectColumnMapping(headers);
  const existing = await prisma.trabajoProcesamiento.findUnique({ where: { operacionId: input.operationId }, select: { id: true, baseId: true } });
  if (existing) {
    if (existing.baseId !== input.baseId) throw new Error("La operación ya existe para otra base.");
    return { jobId: existing.id, baseId: input.baseId, reused: true };
  }
  const totalRows = input.sources.reduce((total, source) => total + source.totalRows, 0);
  if (!totalRows) throw new Error("Las fuentes CSV no contienen filas de datos.");
  const totalBlocks = input.sources.reduce((total, source) => total + Math.ceil(source.totalRows / blockSize), 0);
  const sourcePlans: Omit<ImportFilePlan, "id">[] = [];
  let globalFirstRow = 2;
  for (const source of input.sources) {
    const firstSourceRow = source.firstSourceRow ?? 2;
    sourcePlans.push({ originalName: source.originalName, totalRows: source.totalRows, firstSourceRow, globalFirstRow });
    globalFirstRow += source.totalRows;
  }
  const baseMetadata = metadataFor(headers, mapping, input.sources[0]!.originalName);
  try {
    const result = await prisma.$transaction(async (tx) => {
      const user = await tx.usuario.findUnique({ where: { id: input.userId }, select: { activo: true } });
      if (!user?.activo) throw new Error("El usuario no está disponible.");
      const base = await tx.base.create({ data: { id: input.baseId, codigo: await nextBaseCode(tx, input.receivedAt ?? null), nombreOriginal: input.sources[0]!.originalName, nombreDescriptivo: input.name.trim(), fechaRecepcion: input.receivedAt ?? null, tipo: "ORIGINAL", estado: "LISTA_PARA_LIMPIAR", cantidadImportados: totalRows, cantidadValidos: 0, cantidadExcluidos: 0, metadatos: baseMetadata as unknown as Prisma.InputJsonValue } });
      const job = await tx.trabajoProcesamiento.create({ data: { operacionId: input.operationId, tipo: "IMPORTACION", usuarioId: input.userId, baseId: base.id, totalBloques: totalBlocks, maxIntentos: 3, metadatos: { version: 1, kind: "INCREMENTAL_CSV", blockSize, sources: [] }, bloques: { createMany: { data: Array.from({ length: totalBlocks }, (_, numeroBloque) => ({ numeroBloque })) } } } });
      const sources: ImportFilePlan[] = [];
      for (const [index, source] of input.sources.entries()) {
        const file = await tx.archivoProcesamiento.create({ data: { trabajoId: job.id, nombreOriginal: source.originalName, tipoContenido: source.contentType?.trim() || "text/csv", tamanoBytes: source.bytes, huellaContenido: source.contentHash.toLowerCase(), referenciaPrivada: source.privateReference.trim(), metadatos: { version: 1, sourceIndex: index, headers, firstSourceRow: sourcePlans[index]!.firstSourceRow, totalRows: source.totalRows } } });
        sources.push({ id: file.id, ...sourcePlans[index]! });
      }
      await tx.trabajoProcesamiento.update({ where: { id: job.id }, data: { metadatos: { version: 1, kind: "INCREMENTAL_CSV", blockSize, sources } } });
      return { jobId: job.id, baseId: base.id };
    });
    return { ...result, reused: false };
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
    const raced = await prisma.trabajoProcesamiento.findUniqueOrThrow({ where: { operacionId: input.operationId }, select: { id: true, baseId: true } });
    if (raced.baseId !== input.baseId) throw new Error("La operación ya existe para otra base.");
    return { jobId: raced.id, baseId: input.baseId, reused: true };
  }
}

export async function claimIncrementalCsvBlock(input: { jobId: string; userId: string; workerId: string; leaseMs: number }) {
  const claim = await claimProcessingBlock(input);
  if (!claim) return null;
  const job = await prisma.trabajoProcesamiento.findFirst({ where: { id: input.jobId, usuarioId: input.userId }, select: { metadatos: true } });
  const descriptor = sourceForBlock(planFrom(job?.metadatos), claim.number);
  return { ...claim, ...descriptor };
}

export async function persistIncrementalCsvBlock(input: { jobId: string; blockId: string; userId: string; workerId: string; fileId: string; blockNumber: number; rows: readonly IncrementalCsvRow[] }) {
  const [job, block] = await Promise.all([
    prisma.trabajoProcesamiento.findFirst({ where: { id: input.jobId, usuarioId: input.userId }, select: { baseId: true, metadatos: true, base: { select: { metadatos: true, archivadaEn: true } } } }),
    prisma.bloqueTrabajoProcesamiento.findFirst({ where: { id: input.blockId, trabajoId: input.jobId }, select: { numeroBloque: true } }),
  ]);
  if (!job?.baseId || job.base?.archivadaEn) throw new Error("La base de importación no está disponible.");
  if (!block || block.numeroBloque !== input.blockNumber) throw new Error("El bloque no coincide con el checkpoint solicitado.");
  const plan = planFrom(job.metadatos);
  const descriptor = sourceForBlock(plan, input.blockNumber);
  if (descriptor.source.id !== input.fileId || input.rows.length !== descriptor.rowCount) throw new Error("Las filas no coinciden con el bloque planificado.");
  const metadata = job.base?.metadatos as unknown as StoredMetadata;
  const records: StoredRecord[] = input.rows.map((row, index) => {
    if (row.sourceRow !== descriptor.firstRow + index) throw new Error("Las filas CSV no respetan el checkpoint del bloque.");
    const cells = row.cells.map(String);
    const aligned = cells.length === metadata.columns.length ? cells : Array.from({ length: metadata.columns.length }, (_, column) => cells[column] ?? "");
    const raw = { mobile: aligned[metadata.columnMapping.movil] ?? "", name: metadata.columnMapping.nombre === undefined ? "" : aligned[metadata.columnMapping.nombre] ?? "" };
    const derived = tipificationFor(raw, metadata.columnMapping);
    return { sourceRow: descriptor.globalFirstRow + index, cells: aligned, mobile: raw.mobile, document: metadata.columnMapping.documento === undefined ? "" : aligned[metadata.columnMapping.documento] ?? "", name: raw.name, contactPhone: metadata.columnMapping.telefono_contacto === undefined ? "" : aligned[metadata.columnMapping.telefono_contacto] ?? "", normalizedMobile: derived.normalizedMobile, reason: derived.reason, tipification: derived.tipification, enrichedCells: null, provenance: "EXCEL" };
  });
  assertIncomingRecordIntegrity(records, metadata.columnMapping);
  return completeProcessingBlock({ jobId: input.jobId, blockId: input.blockId, userId: input.userId, workerId: input.workerId, checkpoint: { fileId: input.fileId, nextSourceRow: descriptor.firstRow + input.rows.length, nextGlobalRow: descriptor.globalFirstRow + input.rows.length }, summary: { rows: records.length, fileId: input.fileId }, apply: async (tx) => {
    const file = await tx.archivoProcesamiento.findFirst({ where: { id: input.fileId, trabajoId: input.jobId }, select: { id: true } });
    if (!file) throw new ProcessingJobError("El archivo del bloque no pertenece al trabajo.");
    // A completed checkpoint is the idempotency boundary.  Do not silently skip
    // an unexpected duplicate here: it would make a corrupted/replayed block
    // look complete even though its source rows were not persisted as planned.
    await tx.registro.createMany({ data: records.map((record, index) => ({ baseId: job.baseId!, numeroFilaOriginal: record.sourceRow, movilNormalizado: record.normalizedMobile, documento: record.document || null, nombre: record.name || null, operadorActual: null, operadorOriginal: null, fechaPortabilidad: null, tipificacion: record.tipification, datosOriginales: { version: 1, cells: record.cells, mobile: record.mobile, contactPhone: record.contactPhone, reason: record.reason, enrichedCells: null, provenance: "EXCEL" }, archivoProcesamientoId: input.fileId, hojaOrigen: "CSV", numeroFilaArchivo: descriptor.firstRow + index })) });
  } });
}

export async function finalizeIncrementalCsvImport(input: { jobId: string; userId: string }) {
  const job = await prisma.trabajoProcesamiento.findFirst({ where: { id: input.jobId, usuarioId: input.userId }, select: { id: true, baseId: true, estado: true } });
  if (!job?.baseId) throw new Error("El trabajo de importación no está disponible.");
  const baseId = job.baseId;
  if (job.estado !== "COMPLETADO") throw new Error("La importación aún tiene bloques pendientes o fallidos.");
  return prisma.$transaction(async (tx) => {
    const base = await tx.base.findUniqueOrThrow({ where: { id: baseId }, select: { metadatos: true, cantidadImportados: true, archivadaEn: true } });
    if (base.archivadaEn) throw new Error("La base está archivada.");
    const stored = base.metadatos as unknown as StoredMetadata;
    if (stored.completed) return { baseId, reused: true };
    const count = await tx.registro.count({ where: { baseId } });
    if (count !== base.cantidadImportados) throw new Error("No se puede finalizar una base con filas faltantes.");
    await tx.$executeRaw(Prisma.sql`
      WITH repetidos AS (
        SELECT id, ROW_NUMBER() OVER (PARTITION BY movil_normalizado ORDER BY numero_fila_original ASC) AS posicion
        FROM registros WHERE base_id = ${baseId}::uuid AND tipificacion = 'VALIDO' AND movil_normalizado IS NOT NULL
      )
      UPDATE registros AS registro SET movil_normalizado = NULL, tipificacion = 'TELEFONO_DUPLICADO'
      FROM repetidos WHERE registro.id = repetidos.id AND repetidos.posicion > 1
    `);
    const grouped = await tx.registro.groupBy({ by: ["tipificacion"], where: { baseId }, _count: true });
    const valid = grouped.find((entry) => entry.tipificacion === "VALIDO")?._count ?? 0;
    await tx.base.update({ where: { id: baseId }, data: { estado: "LISTA_PARA_ENRIQUECER", cantidadValidos: valid, cantidadExcluidos: count - valid, metadatos: { ...stored, completed: true, revision: null, incrementalImport: { version: 1, jobId: job.id } } as unknown as Prisma.InputJsonValue } });
    return { baseId, reused: false, imported: count, valid, excluded: count - valid };
  });
}

export async function getIncrementalCsvImportStatus(input: { jobId: string; userId: string }) {
  return getProcessingJob(input);
}
