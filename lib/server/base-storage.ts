import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { enrichmentScalars, type SaveStartPayload, type SavedLot, type StoredMetadata, type StoredRecord } from "@/lib/persistence/workspace-persistence";
import { prisma } from "@/lib/server/prisma";

function metadata(value: unknown): StoredMetadata | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<StoredMetadata>;
  return candidate.version === 1 && typeof candidate.originalFileName === "string" ? candidate as StoredMetadata : null;
}

export async function beginBaseSave(input: SaveStartPayload) {
  const existing = await prisma.base.findUnique({ where: { id: input.id }, select: { metadatos: true } });
  const old = metadata(existing?.metadatos);
  const nextMetadata: StoredMetadata = { ...input.metadata, revision: input.revision, completed: false };
  if (!existing || old?.revision !== input.revision) {
    await prisma.$transaction([
      ...(existing ? [prisma.lote.deleteMany({ where: { baseId: input.id } }), prisma.registro.deleteMany({ where: { baseId: input.id } })] : []),
      prisma.base.upsert({
        where: { id: input.id },
        create: { id: input.id, nombreOriginal: input.name, estado: input.state, cantidadImportados: input.expectedRecords, cantidadValidos: input.validRecords, cantidadExcluidos: input.excludedRecords, metadatos: nextMetadata as unknown as Prisma.InputJsonValue },
        update: { nombreOriginal: input.name, estado: input.state, cantidadImportados: input.expectedRecords, cantidadValidos: input.validRecords, cantidadExcluidos: input.excludedRecords, metadatos: nextMetadata as unknown as Prisma.InputJsonValue },
      }),
    ]);
  }
}

export async function saveRecordChunk(baseId: string, revision: string, records: StoredRecord[]) {
  const base = await prisma.base.findUnique({ where: { id: baseId }, select: { metadatos: true } });
  const baseMetadata = metadata(base?.metadatos);
  if (!baseMetadata || baseMetadata.completed || baseMetadata.revision !== revision) return false;
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

export async function completeBaseSave(baseId: string, revision: string, lots: SavedLot[]) {
  const base = await prisma.base.findUnique({ where: { id: baseId }, select: { metadatos: true, cantidadImportados: true } });
  const baseMetadata = metadata(base?.metadatos);
  if (!base || !baseMetadata || baseMetadata.revision !== revision) return false;
  const count = await prisma.registro.count({ where: { baseId } });
  if (count !== base.cantidadImportados) throw new Error("La carga de registros aún no está completa.");
  if (!baseMetadata.completed) {
    const savedRecords = await prisma.registro.findMany({ where: { baseId }, select: { id: true, numeroFilaOriginal: true } });
    const byRow = new Map(savedRecords.map((record) => [record.numeroFilaOriginal, record.id]));
    for (const lot of lots) if (!lot.sourceRows.every((sourceRow) => byRow.has(sourceRow))) throw new Error("Un lote contiene registros ajenos a la base.");
    await prisma.$transaction(async (transaction) => {
      await transaction.lote.deleteMany({ where: { baseId } });
      for (const lot of lots) {
        const created = await transaction.lote.create({ data: { baseId, campana: lot.campaign, numeroLote: lot.number, cantidadRegistros: lot.sourceRows.length } });
        if (lot.sourceRows.length) await transaction.loteRegistro.createMany({ data: lot.sourceRows.map((sourceRow) => ({ loteId: created.id, registroId: byRow.get(sourceRow)! })) });
      }
      await transaction.base.update({ where: { id: baseId }, data: { metadatos: { ...baseMetadata, completed: true, revision: null } as unknown as Prisma.InputJsonValue } });
    });
  }
  return true;
}

export async function listSavedBases() {
  const bases = await prisma.base.findMany({ orderBy: { actualizadoEn: "desc" }, select: { id: true, nombreOriginal: true, creadoEn: true, actualizadoEn: true, estado: true, cantidadImportados: true, cantidadValidos: true, cantidadExcluidos: true, metadatos: true } });
  return bases.filter((base) => metadata(base.metadatos)?.completed).map((base) => ({ id: base.id, name: base.nombreOriginal, createdAt: base.creadoEn.toISOString(), updatedAt: base.actualizadoEn.toISOString(), state: base.estado, imported: base.cantidadImportados, valid: base.cantidadValidos, excluded: base.cantidadExcluidos }));
}

export async function getSavedBase(baseId: string) {
  const base = await prisma.base.findUnique({ where: { id: baseId }, include: { registros: { orderBy: { numeroFilaOriginal: "asc" } } } });
  const baseMetadata = metadata(base?.metadatos);
  if (!base || !baseMetadata?.completed) return null;
  return {
    id: base.id, name: base.nombreOriginal, createdAt: base.creadoEn.toISOString(), metadata: baseMetadata,
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
