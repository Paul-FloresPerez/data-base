import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { enrichmentScalars, type SaveStartPayload, type SavedLot, type StoredMetadata, type StoredRecord } from "@/lib/persistence/workspace-persistence";
import { prisma } from "@/lib/server/prisma";
import { appendBaseLifecycleEvents } from "@/lib/server/audit-storage";
import { linkGeneratedRecycledBase } from "@/lib/server/recycling-storage";
import { nextBaseCode } from "@/lib/server/base-code";
import { assertCompletedRecordIntegrity, assertIncomingRecordIntegrity, assertLotsIntegrity } from "@/lib/server/base-integrity";

function metadata(value: unknown): StoredMetadata | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<StoredMetadata>;
  return candidate.version === 1 && typeof candidate.originalFileName === "string" ? candidate as StoredMetadata : null;
}

function receiptDate(value: string | null): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export async function beginBaseSave(input: SaveStartPayload) {
  const existing = await prisma.base.findUnique({ where: { id: input.id }, select: { metadatos: true, codigo: true, tipo: true, baseOriginalId: true } });
  const old = metadata(existing?.metadatos);
  const nextMetadata: StoredMetadata = { ...input.metadata, revision: input.revision, completed: false };
  if (input.state === "LISTA_PARA_LIMPIAR" && (input.validRecords !== 0 || input.excludedRecords !== 0)) {
    throw new Error("Una base sin limpieza no puede declarar recuentos operativos.");
  }
  if (!existing || old?.revision !== input.revision) {
    const isRecycled = input.metadata.kind === "RECICLADA";
    if (isRecycled && !input.originalBaseId) throw new Error("Una base reciclada debe seleccionar exactamente una base original.");
    if (!isRecycled && input.originalBaseId) throw new Error("Una base original no puede asociarse a otra base.");
    if (existing && (existing.tipo !== (isRecycled ? "RECICLADA" : "ORIGINAL") || existing.baseOriginalId !== (isRecycled ? input.originalBaseId : null))) {
      throw new Error("No se puede cambiar la pertenencia de una base existente.");
    }
    if (isRecycled) {
      const original = await prisma.base.findUnique({ where: { id: input.originalBaseId! }, select: { tipo: true, metadatos: true } });
      if (!original || original.tipo !== "ORIGINAL" || !metadata(original.metadatos)?.completed) {
        throw new Error("La base original asociada no está disponible.");
      }
    }
    const receivedAt = receiptDate(input.receivedAt);
    await prisma.$transaction(async (transaction) => {
      if (existing) {
        await transaction.lote.deleteMany({ where: { baseId: input.id } });
        // A completed base is immutable at the source-row level. Upserts in
        // saveRecordChunk enrich those same records without erasing their
        // original JSON columns; only an interrupted incomplete save is reset.
        if (!old?.completed) await transaction.registro.deleteMany({ where: { baseId: input.id } });
      }
      const code = existing?.codigo ?? await nextBaseCode(transaction, receivedAt);
      // An original base is its own root; null avoids a needless self-FK that
      // would make retention/archiving harder. Derived bases carry the root ID.
      const baseOriginalId = isRecycled ? input.originalBaseId! : null;
      const data = {
        codigo: code,
        nombreOriginal: input.metadata.originalFileName,
        nombreDescriptivo: input.name,
        fechaRecepcion: receivedAt,
        tipo: isRecycled ? "RECICLADA" as const : "ORIGINAL" as const,
        baseOriginalId,
        estado: input.state,
        cantidadImportados: input.expectedRecords,
        cantidadValidos: input.validRecords,
        cantidadExcluidos: input.excludedRecords,
        metadatos: nextMetadata as unknown as Prisma.InputJsonValue,
      };
      await transaction.base.upsert({ where: { id: input.id }, create: { id: input.id, ...data }, update: data });
    });
  }
}

export async function saveRecordChunk(baseId: string, revision: string, records: StoredRecord[]) {
  const base = await prisma.base.findUnique({ where: { id: baseId }, select: { metadatos: true, estado: true } });
  const baseMetadata = metadata(base?.metadatos);
  if (!baseMetadata || baseMetadata.completed || baseMetadata.revision !== revision) return false;
  assertIncomingRecordIntegrity(records, baseMetadata.columnMapping);
  const existing = await prisma.registro.findMany({ where: { baseId, numeroFilaOriginal: { in: records.map((record) => record.sourceRow) } }, select: { numeroFilaOriginal: true, datosOriginales: true } });
  const existingByRow = new Map(existing.map((record) => [record.numeroFilaOriginal, record.datosOriginales]));
  for (const record of records) {
    const previous = existingByRow.get(record.sourceRow);
    if (previous && JSON.stringify(previous) !== JSON.stringify({ version: 1, cells: record.cells, mobile: record.mobile, contactPhone: record.contactPhone, reason: record.reason, enrichedCells: record.enrichedCells, provenance: record.provenance })) {
      throw new Error("Una fila ya guardada no puede cambiar dentro de la misma revisión.");
    }
  }
  await prisma.$transaction(records.map((record) => {
    const scalar = enrichmentScalars(record.enrichedCells, baseMetadata.enrichmentColumns ?? []);
    const data = {
      movilNormalizado: record.normalizedMobile,
      documento: record.document || null,
      nombre: record.name || null,
      operadorActual: scalar.operadorActual,
      operadorOriginal: scalar.operadorOriginal,
      fechaPortabilidad: scalar.fechaPortabilidad,
      tipificacion: record.tipification,
      datosOriginales: { version: 1, cells: record.cells, mobile: record.mobile, contactPhone: record.contactPhone, reason: record.reason, enrichedCells: record.enrichedCells, provenance: record.provenance } as Prisma.InputJsonValue,
    };
    return prisma.registro.upsert({ where: { baseId_numeroFilaOriginal: { baseId, numeroFilaOriginal: record.sourceRow } }, create: { baseId, numeroFilaOriginal: record.sourceRow, ...data }, update: data });
  }));
  return true;
}

export async function completeBaseSave(baseId: string, revision: string, lots: SavedLot[], userId: string) {
  const base = await prisma.base.findUnique({ where: { id: baseId }, select: { metadatos: true, cantidadImportados: true, cantidadValidos: true, cantidadExcluidos: true, baseOriginalId: true, estado: true } });
  const baseMetadata = metadata(base?.metadatos);
  if (!base || !baseMetadata || baseMetadata.revision !== revision) return false;
  const count = await prisma.registro.count({ where: { baseId } });
  if (count !== base.cantidadImportados) throw new Error("La carga de registros aún no está completa.");
  if (!baseMetadata.completed) {
    const savedRecords = await prisma.registro.findMany({ where: { baseId }, select: { id: true, numeroFilaOriginal: true, movilNormalizado: true, tipificacion: true, datosOriginales: true } });
    const recordsForIntegrity: StoredRecord[] = savedRecords.map((record) => {
      const original = record.datosOriginales as { cells?: unknown; mobile?: unknown; contactPhone?: unknown; reason?: unknown; enrichedCells?: unknown; provenance?: unknown };
      return {
        sourceRow: record.numeroFilaOriginal,
        cells: Array.isArray(original.cells) ? original.cells.map(String) : [],
        mobile: typeof original.mobile === "string" ? original.mobile : "",
        document: "",
        name: "",
        contactPhone: typeof original.contactPhone === "string" ? original.contactPhone : "",
        normalizedMobile: record.movilNormalizado,
        reason: typeof original.reason === "string" ? original.reason as StoredRecord["reason"] : null,
        tipification: record.tipificacion,
        enrichedCells: Array.isArray(original.enrichedCells) ? original.enrichedCells.map(String) : null,
        provenance: ["EXCEL", "CRM", "MOCK", "API_REAL"].includes(String(original.provenance)) ? original.provenance as StoredRecord["provenance"] : "EXCEL",
      };
    });
    // Name/document are top-level columns and are intentionally restored here
    // from the persisted scalar values below to avoid accepting client values.
    const scalarRecords = await prisma.registro.findMany({ where: { baseId }, select: { numeroFilaOriginal: true, documento: true, nombre: true } });
    const scalarsByRow = new Map(scalarRecords.map((record) => [record.numeroFilaOriginal, record]));
    for (const record of recordsForIntegrity) {
      const scalar = scalarsByRow.get(record.sourceRow)!;
      record.document = scalar.documento ?? "";
      record.name = scalar.nombre ?? "";
    }
    const derived = assertCompletedRecordIntegrity(recordsForIntegrity, baseMetadata.columnMapping, base.estado);
    const validCount = [...derived.values()].filter((record) => record.tipification === "VALIDO").length;
    const excludedCount = recordsForIntegrity.length - validCount;
    if (base.estado !== "LISTA_PARA_LIMPIAR" && (base.cantidadValidos !== validCount || base.cantidadExcluidos !== excludedCount)) {
      throw new Error("Los recuentos declarados no coinciden con los registros originales.");
    }
    if (base.estado === "LISTA_PARA_LIMPIAR" && lots.length > 0) throw new Error("Una base sin limpiar no puede contener lotes.");
    assertLotsIntegrity(lots, derived);
    const byRow = new Map(savedRecords.map((record) => [record.numeroFilaOriginal, record.id]));
    await prisma.$transaction(async (transaction) => {
      await transaction.lote.deleteMany({ where: { baseId } });
      for (const lot of lots) {
        const created = await transaction.lote.create({ data: { baseId, baseOriginalId: base.baseOriginalId ?? baseId, campana: lot.campaign, numeroLote: lot.number, cantidadRegistros: lot.sourceRows.length } });
        if (lot.sourceRows.length) await transaction.loteRegistro.createMany({ data: lot.sourceRows.map((sourceRow) => ({ loteId: created.id, registroId: byRow.get(sourceRow)! })) });
      }
      const historicalImports = baseMetadata.historicalResultImports
        ?? (baseMetadata.historicalResultImport ? [baseMetadata.historicalResultImport] : []);
      for (const importedFile of historicalImports) {
        if (!importedFile.importId) continue;
        await transaction.archivoTipificaciones.upsert({
          where: { importacionId: importedFile.importId },
          create: {
            importacionId: importedFile.importId,
            baseId,
            nombreArchivo: importedFile.sourceFileName,
            resumen: importedFile as unknown as Prisma.InputJsonValue,
          },
          update: {},
        });
      }
      if (baseMetadata.recyclingExecutionId) {
        if (!base.baseOriginalId) throw new Error("Una ejecución de reciclaje requiere una base original.");
        await linkGeneratedRecycledBase(transaction, { executionId: baseMetadata.recyclingExecutionId, baseId, baseOriginalId: base.baseOriginalId });
      }
      await transaction.base.update({ where: { id: baseId }, data: { cantidadValidos: validCount, cantidadExcluidos: excludedCount, metadatos: { ...baseMetadata, completed: true, revision: null } as unknown as Prisma.InputJsonValue } });
      await appendBaseLifecycleEvents(transaction, { baseId, userId, metadata: baseMetadata, imported: base.cantidadImportados, valid: validCount, excluded: excludedCount, lots });
    });
  }
  return true;
}

export async function listSavedBases() {
  const bases = await prisma.base.findMany({ orderBy: { actualizadoEn: "desc" }, select: { id: true, codigo: true, nombreOriginal: true, nombreDescriptivo: true, fechaRecepcion: true, tipo: true, baseOriginalId: true, creadoEn: true, actualizadoEn: true, estado: true, cantidadImportados: true, cantidadValidos: true, cantidadExcluidos: true, metadatos: true } });
  return bases.flatMap((base) => {
    const stored = metadata(base.metadatos);
    return stored?.completed ? [{ id: base.id, code: base.codigo, name: base.nombreDescriptivo, originalFileName: base.nombreOriginal, receivedAt: base.fechaRecepcion?.toISOString().slice(0, 10) ?? null, originalBaseId: base.baseOriginalId, createdAt: base.creadoEn.toISOString(), updatedAt: base.actualizadoEn.toISOString(), state: base.estado, kind: base.tipo, imported: base.cantidadImportados, valid: base.cantidadValidos, excluded: base.cantidadExcluidos }] : [];
  });
}

export async function getSavedBase(baseId: string) {
  const base = await prisma.base.findUnique({ where: { id: baseId }, include: { registros: { orderBy: { numeroFilaOriginal: "asc" } } } });
  const baseMetadata = metadata(base?.metadatos);
  if (!base || !baseMetadata?.completed) return null;
  return {
    id: base.id, code: base.codigo, name: base.nombreDescriptivo, originalFileName: base.nombreOriginal, receivedAt: base.fechaRecepcion?.toISOString().slice(0, 10) ?? null, originalBaseId: base.baseOriginalId, createdAt: base.creadoEn.toISOString(), metadata: baseMetadata,
    records: base.registros.map((record) => {
      const original = record.datosOriginales as { cells?: unknown; mobile?: unknown; contactPhone?: unknown; reason?: unknown; enrichedCells?: unknown; provenance?: unknown };
      const provenance = ["EXCEL", "CRM", "MOCK", "API_REAL"].includes(String(original.provenance)) ? String(original.provenance) : "EXCEL";
      return { id: record.id, sourceRow: record.numeroFilaOriginal, cells: Array.isArray(original.cells) ? original.cells.map(String) : [], mobile: typeof original.mobile === "string" ? original.mobile : "", document: record.documento ?? "", name: record.nombre ?? "", contactPhone: typeof original.contactPhone === "string" ? original.contactPhone : "", normalizedMobile: record.movilNormalizado, reason: typeof original.reason === "string" ? original.reason : null, tipification: record.tipificacion, enrichedCells: Array.isArray(original.enrichedCells) ? original.enrichedCells.map(String) : null, provenance };
    }),
  };
}

export async function deleteSavedBase(baseId: string) {
  await prisma.base.delete({ where: { id: baseId } });
}
