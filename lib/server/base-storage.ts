import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { enrichmentScalars, type SaveStartPayload, type SavedLot, type StoredMetadata, type StoredRecord } from "@/lib/persistence/workspace-persistence";
import { commercialMatrixSnapshot } from "@/lib/campaigns/campaign-engine";
import { prisma } from "@/lib/server/prisma";
import { appendBaseLifecycleEvents } from "@/lib/server/audit-storage";
import { linkGeneratedRecycledBase } from "@/lib/server/recycling-storage";
import { nextBaseCode } from "@/lib/server/base-code";
import { assertCommercialLotsIntegrity, assertCompletedRecordIntegrity, assertIncomingRecordIntegrity, assertLotsIntegrity } from "@/lib/server/base-integrity";
import { lockCommercialMobiles } from "@/lib/server/commercial-locks";
import { createCommercialReservations, transitionCommercialReservations } from "@/lib/server/commercial-reservation-storage";
import { normalizeOriginalBaseSearch, type OriginalBaseOption } from "@/lib/base-history/original-base-search";

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

function transitionReservationIds(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  const transition = (value as { globalTransition?: unknown }).globalTransition;
  if (!transition || typeof transition !== "object") return [];
  const ids = (transition as { priorReservationIds?: unknown }).priorReservationIds;
  return Array.isArray(ids) ? [...new Set(ids.filter((id): id is string => typeof id === "string"))] : [];
}

/** Preserve the server-created global snapshot evidence when a generated base
 * is reopened and saved for its later commercial confirmation. It is never
 * accepted from the browser as a new authorization. */
function preservedGlobalTransition(value: unknown): Prisma.InputJsonValue | null {
  if (!value || typeof value !== "object") return null;
  const transition = (value as { globalTransition?: unknown }).globalTransition;
  if (!transition || typeof transition !== "object") return null;
  const executionId = (transition as { executionId?: unknown }).executionId;
  const priorReservationIds = transitionReservationIds(value);
  if (typeof executionId !== "string") return null;
  return { executionId, priorReservationIds } as Prisma.InputJsonValue;
}

export type CompleteBaseSaveResult = {
  completed: true;
  createdLots: number;
  releasedPriorReservations: number;
};

/** JSONB does not preserve property insertion order; compare the immutable row
 * payload structurally so re-opening a generated recycled base is not rejected
 * merely because PostgreSQL returned the same object with a different key order. */
function sameStoredOriginalRow(value: unknown, record: StoredRecord): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const original = value as Record<string, unknown>;
  return original.version === 1
    && JSON.stringify(original.cells) === JSON.stringify(record.cells)
    && original.mobile === record.mobile
    && original.contactPhone === record.contactPhone
    && original.reason === record.reason
    && JSON.stringify(original.enrichedCells) === JSON.stringify(record.enrichedCells)
    && original.provenance === record.provenance;
}

export async function beginBaseSave(input: SaveStartPayload) {
  const existing = await prisma.base.findUnique({ where: { id: input.id }, select: { metadatos: true, codigo: true, tipo: true, baseOriginalId: true, estado: true, archivadaEn: true, _count: { select: { lotes: true } } } });
  const old = metadata(existing?.metadatos);
  const nextMetadata: StoredMetadata = { ...input.metadata, revision: input.revision, completed: false };
  if (existing?.archivadaEn) throw new Error("La base está archivada y no admite cambios operativos.");
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
        const generatedRecycledBase = existing.tipo === "RECICLADA" && old?.completed && Boolean(old.recyclingExecutionId || old.globalRecyclingExecutionId);
        // Releases before the cleaning guard could complete a newly imported
        // original while it was still LISTA_PARA_LIMPIAR. It is safe to repair
        // only that impossible state: it has no operational record set and is
        // not a confirmed commercial distribution.
        const recoverableInitialSave = existing.tipo === "ORIGINAL" && existing.estado === "LISTA_PARA_LIMPIAR" && old?.completed;
        // A saved base without lots is an editable operational snapshot. It
        // must accept a later enrichment/filter save, but a confirmed lot is
        // immutable because it owns commercial reservations and audit history.
        const editableOperationalSave = existing._count.lotes === 0 && old?.completed;
        if (old?.completed && !generatedRecycledBase && !recoverableInitialSave && !editableOperationalSave) throw new Error("Una base con distribución confirmada no puede reemplazarse.");
        await transaction.lote.deleteMany({ where: { baseId: input.id } });
        // A completed base is immutable at the source-row level. Upserts in
        // saveRecordChunk enrich those same records without erasing their
        // original JSON columns; only an interrupted incomplete save is reset.
        if ((!old?.completed || recoverableInitialSave || editableOperationalSave) && !generatedRecycledBase) {
          await transaction.registro.deleteMany({ where: { baseId: input.id } });
        }
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
  const base = await prisma.base.findUnique({ where: { id: baseId }, select: { metadatos: true, estado: true, archivadaEn: true } });
  const baseMetadata = metadata(base?.metadatos);
  if (base?.archivadaEn) throw new Error("La base está archivada y no admite cambios operativos.");
  if (!baseMetadata || baseMetadata.completed || baseMetadata.revision !== revision) return false;
  assertIncomingRecordIntegrity(records, baseMetadata.columnMapping);
  const existing = await prisma.registro.findMany({ where: { baseId, numeroFilaOriginal: { in: records.map((record) => record.sourceRow) } }, select: { numeroFilaOriginal: true, datosOriginales: true } });
  const existingByRow = new Map(existing.map((record) => [record.numeroFilaOriginal, record.datosOriginales]));
  for (const record of records) {
    const previous = existingByRow.get(record.sourceRow);
    if (previous && !sameStoredOriginalRow(previous, record)) {
      throw new Error("Una fila ya guardada no puede cambiar dentro de la misma revisión.");
    }
  }
  // A client chunk contains up to 100 records. Neon may need more than the
  // Prisma default five seconds when reopening a generated global base, so the
  // complete chunk remains one atomic write with an explicit bounded timeout.
  await prisma.$transaction(records.map((record) => {
    const scalar = enrichmentScalars(record.enrichedCells, baseMetadata.enrichmentColumns ?? []);
    const preservedTransition = preservedGlobalTransition(existingByRow.get(record.sourceRow));
    const data = {
      movilNormalizado: record.normalizedMobile,
      documento: record.document || null,
      nombre: record.name || null,
      operadorActual: scalar.operadorActual,
      operadorOriginal: scalar.operadorOriginal,
      fechaPortabilidad: scalar.fechaPortabilidad,
      tipificacion: record.tipification,
      datosOriginales: { version: 1, cells: record.cells, mobile: record.mobile, contactPhone: record.contactPhone, reason: record.reason, enrichedCells: record.enrichedCells, provenance: record.provenance, ...(preservedTransition ? { globalTransition: preservedTransition } : {}) } as Prisma.InputJsonValue,
    };
    return prisma.registro.upsert({ where: { baseId_numeroFilaOriginal: { baseId, numeroFilaOriginal: record.sourceRow } }, create: { baseId, numeroFilaOriginal: record.sourceRow, ...data }, update: data });
  }), { maxWait: 10_000, timeout: 30_000 });
  return true;
}

export async function completeBaseSave(baseId: string, revision: string, lots: SavedLot[], userId: string): Promise<false | CompleteBaseSaveResult> {
  const base = await prisma.base.findUnique({ where: { id: baseId }, select: { tipo: true, metadatos: true, cantidadImportados: true, cantidadValidos: true, cantidadExcluidos: true, baseOriginalId: true, estado: true, archivadaEn: true } });
  const baseMetadata = metadata(base?.metadatos);
  if (!base || !baseMetadata) return false;
  // The final response can be lost after PostgreSQL commits. Repeating that
  // exact user action must report the persisted snapshot rather than turning a
  // successful no-lot ORIGINAL save into a client-side error. It performs no
  // new write, lot creation, reservation or release.
  if (baseMetadata.completed && baseMetadata.revision === null && lots.length === 0) {
    const createdLots = await prisma.lote.count({ where: { baseId } });
    // A no-lot completion cannot acknowledge a prior commercial confirmation:
    // callers must reopen a fresh revision before confirming a distribution.
    if (createdLots === 0) return { completed: true, createdLots: 0, releasedPriorReservations: 0 };
    return false;
  }
  if (baseMetadata.revision !== revision) return false;
  if (base.archivadaEn) throw new Error("La base está archivada y no admite distribución ni guardado operativo.");
  if (base.estado === "LISTA_PARA_LIMPIAR") {
    throw new Error("Completa la limpieza antes de guardar la base en el historial.");
  }
  const count = await prisma.registro.count({ where: { baseId } });
  if (count !== base.cantidadImportados) throw new Error("La carga de registros aún no está completa.");
  if (!baseMetadata.completed) {
    const savedRecords = await prisma.registro.findMany({ where: { baseId }, select: { id: true, numeroFilaOriginal: true, movilNormalizado: true, tipificacion: true, operadorActual: true, datosOriginales: true } });
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
    if (base.cantidadValidos !== validCount || base.cantidadExcluidos !== excludedCount) {
      throw new Error("Los recuentos declarados no coinciden con los registros originales.");
    }
    assertLotsIntegrity(lots, derived);
    assertCommercialLotsIntegrity(lots, savedRecords.map((record) => {
      const original = record.datosOriginales as { provenance?: unknown };
      return {
        sourceRow: record.numeroFilaOriginal,
        operadorActual: record.operadorActual,
        provenance: ["EXCEL", "CRM", "MOCK", "API_REAL"].includes(String(original.provenance)) ? String(original.provenance) : "EXCEL",
      };
    }));
    // This is intentionally enforced immediately before persisting lots, not
    // only in the browser campaign view. A confirmed external sale blocks the
    // mobile across every base and campaign.
    const mobilesToDistribute = lots.flatMap((lot) => lot.sourceRows.flatMap((row) => {
      const mobile = derived.get(row)?.normalizedMobile;
      return mobile ? [mobile] : [];
    }));
    const byRow = new Map(savedRecords.map((record) => [record.numeroFilaOriginal, record.id]));
    // A confirmed recycled transition can legitimately close and replace up to
    // several 100-record lots. Keep the advisory locks and every mutation in
    // one transaction, but give Neon enough time to persist its audit rows.
    const result = await prisma.$transaction(async (transaction) => {
      await lockCommercialMobiles(transaction, mobilesToDistribute);
      const sales = await transaction.ventaExterna.findMany({ where: { movilNormalizado: { in: [...new Set(mobilesToDistribute)] }, estado: "CONFIRMADA" }, select: { movilNormalizado: true } });
      if (sales.length) throw new Error("No se puede distribuir un móvil con una venta comercial confirmada.");
      await transaction.lote.deleteMany({ where: { baseId } });
      const reservations: { baseId: string; loteId: string; campaign: "YOIGO" | "VODAFONE"; mobile: string; operationId: string }[] = [];
      for (const lot of lots) {
        const created = await transaction.lote.create({ data: { baseId, baseOriginalId: base.baseOriginalId ?? baseId, campana: lot.campaign, numeroLote: lot.number, cantidadRegistros: lot.sourceRows.length } });
        if (lot.sourceRows.length) await transaction.loteRegistro.createMany({ data: lot.sourceRows.map((sourceRow) => ({ loteId: created.id, registroId: byRow.get(sourceRow)! })) });
        for (const sourceRow of lot.sourceRows) {
          const mobile = derived.get(sourceRow)?.normalizedMobile;
          const recordId = byRow.get(sourceRow);
          if (!mobile || !recordId) throw new Error("No se pudo identificar el móvil del lote para reservarlo.");
          reservations.push({ baseId, loteId: created.id, campaign: lot.campaign, mobile, operationId: `reservation:${baseId}:${recordId}` });
        }
      }
      let releasedPriorReservations = 0;
      if (baseMetadata.globalRecyclingExecutionId && reservations.length) {
        if (base.tipo !== "RECICLADA") throw new Error("La transición de reciclaje solo puede aplicarse a una base reciclada.");
        const execution = await transaction.ejecucionReciclajeGlobal.findFirst({
          where: { id: baseMetadata.globalRecyclingExecutionId, baseRecicladaId: baseId },
          select: { id: true },
        });
        if (!execution) throw new Error("La transición no corresponde a la ejecución global que generó esta base.");
        const distributedMobiles = [...new Set(reservations.map((reservation) => reservation.mobile))];
        const eligible = await transaction.decisionEjecucionReciclajeGlobal.findMany({
          where: { ejecucionId: execution.id, movilNormalizado: { in: distributedMobiles }, decision: "ELEGIBLE" },
          select: { movilNormalizado: true },
        });
        if (eligible.length !== distributedMobiles.length) throw new Error("Un lote contiene un móvil no autorizado por la ejecución global.");
        const byMobile = new Map(savedRecords.flatMap((record) => record.movilNormalizado ? [[record.movilNormalizado, transitionReservationIds(record.datosOriginales)] as const] : []));
        const priorReservationIdsByMobile = new Map(distributedMobiles.map((mobile) => [mobile, byMobile.get(mobile) ?? []]));
        const transition = await transitionCommercialReservations(transaction, {
          userId,
          executionId: execution.id,
          operationId: `${baseId}:${revision}`,
          replacements: reservations,
          priorReservationIdsByMobile,
        });
        releasedPriorReservations = transition.released;
      }
      await createCommercialReservations(transaction, { userId, matrixVersion: commercialMatrixSnapshot().version, reservations });
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
      await transaction.base.update({ where: { id: baseId }, data: { cantidadValidos: validCount, cantidadExcluidos: excludedCount, metadatos: { ...baseMetadata, commercialMatrix: commercialMatrixSnapshot(), commercialDistributionConfirmed: lots.length > 0, completed: true, revision: null } as unknown as Prisma.InputJsonValue } });
      await appendBaseLifecycleEvents(transaction, { baseId, userId, metadata: baseMetadata, imported: base.cantidadImportados, valid: validCount, excluded: excludedCount, lots });
      return { completed: true as const, createdLots: lots.length, releasedPriorReservations };
    }, { maxWait: 10_000, timeout: 30_000 });
    return result;
  }
  return { completed: true, createdLots: 0, releasedPriorReservations: 0 };
}

export async function listSavedBases() {
  const bases = await prisma.base.findMany({ orderBy: { actualizadoEn: "desc" }, select: { id: true, codigo: true, nombreOriginal: true, nombreDescriptivo: true, fechaRecepcion: true, tipo: true, baseOriginalId: true, creadoEn: true, actualizadoEn: true, estado: true, cantidadImportados: true, cantidadValidos: true, cantidadExcluidos: true, metadatos: true, archivadaEn: true } });
  return bases.flatMap((base) => {
    const stored = metadata(base.metadatos);
    return stored?.completed ? [{ id: base.id, code: base.codigo, name: base.nombreDescriptivo, originalFileName: base.nombreOriginal, receivedAt: base.fechaRecepcion?.toISOString().slice(0, 10) ?? null, originalBaseId: base.baseOriginalId, createdAt: base.creadoEn.toISOString(), updatedAt: base.actualizadoEn.toISOString(), archivedAt: base.archivadaEn?.toISOString() ?? null, state: base.estado, kind: base.tipo, imported: base.cantidadImportados, valid: base.cantidadValidos, excluded: base.cantidadExcluidos }] : [];
  });
}

type OriginalBaseSearchRow = {
  id: string;
  codigo: string;
  nombre_original: string;
  nombre_descriptivo: string;
  fecha_recepcion: Date | null;
  creado_en: Date;
  estado: string;
  cantidad_importados: number;
  total: bigint;
};

/** Lightweight server-side selector data. It never selects CRM records. */
export async function searchOriginalBases(input: { query: string; page: number; limit: number; selectedId?: string | null }) {
  const query = normalizeOriginalBaseSearch(input.query).slice(0, 120);
  const page = Math.max(0, Math.min(input.page, 10_000));
  const limit = Math.max(1, Math.min(input.limit, 25));
  const offset = page * limit;
  const term = `%${query}%`;
  const accentFrom = "áéíóúüñ";
  const accentTo = "aeiouun";
  const rows = await prisma.$queryRaw<OriginalBaseSearchRow[]>(Prisma.sql`
    SELECT id::text, codigo, nombre_original, nombre_descriptivo, fecha_recepcion, creado_en, estado, cantidad_importados,
      COUNT(*) OVER() AS total
    FROM bases
    WHERE tipo = 'ORIGINAL'
      AND archivada_en IS NULL
      AND metadatos ->> 'completed' = 'true'
      AND estado <> 'LISTA_PARA_LIMPIAR'
      AND cantidad_validos > 0
      AND (${query} = '' OR (
        translate(lower(codigo), ${accentFrom}, ${accentTo}) LIKE ${term}
        OR translate(lower(nombre_descriptivo), ${accentFrom}, ${accentTo}) LIKE ${term}
        OR translate(lower(nombre_original), ${accentFrom}, ${accentTo}) LIKE ${term}
      ))
    ORDER BY actualizado_en DESC, id DESC
    LIMIT ${limit} OFFSET ${offset}
  `);
  const toOption = (row: OriginalBaseSearchRow): OriginalBaseOption => ({
    id: row.id,
    code: row.codigo,
    name: row.nombre_descriptivo,
    originalFileName: row.nombre_original,
    receivedAt: row.fecha_recepcion?.toISOString().slice(0, 10) ?? null,
    imported: row.cantidad_importados,
    state: row.estado,
    kind: "ORIGINAL",
  });
  const selected = input.selectedId ? await prisma.base.findFirst({
    where: { id: input.selectedId, tipo: "ORIGINAL", archivadaEn: null, estado: { not: "LISTA_PARA_LIMPIAR" }, cantidadValidos: { gt: 0 }, metadatos: { path: ["completed"], equals: true } },
    select: { id: true, codigo: true, nombreOriginal: true, nombreDescriptivo: true, fechaRecepcion: true, cantidadImportados: true, estado: true },
  }) : null;
  return {
    bases: rows.map(toOption),
    page,
    limit,
    total: Number(rows[0]?.total ?? BigInt(0)),
    selected: selected ? { id: selected.id, code: selected.codigo, name: selected.nombreDescriptivo, originalFileName: selected.nombreOriginal, receivedAt: selected.fechaRecepcion?.toISOString().slice(0, 10) ?? null, imported: selected.cantidadImportados, state: selected.estado, kind: "ORIGINAL" as const } : null,
  };
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
