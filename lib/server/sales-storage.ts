import "server-only";

import { Prisma } from "@/generated/prisma/client";
import type { SalesEventPreview } from "@/lib/sales/sales-import";
import { prisma } from "@/lib/server/prisma";
import { lockCommercialMobiles } from "@/lib/server/commercial-locks";

type SalesImportInput = {
  importId: string;
  userId: string;
  fileName: string;
  declaredPeriod: string | null;
  events: readonly SalesEventPreview[];
  sourceFingerprint: string;
};

function asDate(value: string | null) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Return only normalized mobile identifiers; never expose commercial details. */
export async function confirmedExternalSales(mobiles: readonly string[]): Promise<Set<string>> {
  if (!mobiles.length) return new Set<string>();
  const rows = await prisma.ventaExterna.findMany({
    where: { movilNormalizado: { in: [...new Set(mobiles)] }, estado: "CONFIRMADA" },
    select: { movilNormalizado: true },
  });
  return new Set<string>(rows.flatMap((row) => row.movilNormalizado ? [row.movilNormalizado] : []));
}

export async function importExternalSales(input: SalesImportInput) {
  const existing = await prisma.importacionVentas.findFirst({
    where: { OR: [{ importacionId: input.importId }, { huellaContenido: input.sourceFingerprint }] },
    select: { id: true, resumen: true },
  });
  if (existing) return { reused: true, summary: existing.resumen };

  const validMobiles = input.events.filter((event) => event.reason === "VALIDA" && event.mobile).map((event) => event.mobile!);
  // Only confirmed sales contend with commercial distribution. Ambiguous and
  // non-confirmed rows remain historical records without serializing lots.
  const confirmedMobiles = input.events
    .filter((event) => event.reason === "VALIDA" && event.saleStatus === "CONFIRMADA" && event.mobile)
    .map((event) => event.mobile!);
  const [inBases, alreadyBlocked] = await Promise.all([
    prisma.registro.findMany({ where: { movilNormalizado: { in: validMobiles } }, select: { movilNormalizado: true }, distinct: ["movilNormalizado"] }),
    confirmedExternalSales(validMobiles),
  ]);
  const inBase = new Set(inBases.flatMap((row) => row.movilNormalizado ? [row.movilNormalizado] : []));
  const summary = {
    totalRows: input.events.length,
    validUnique: validMobiles.length,
    invalid: input.events.filter((event) => event.reason === "MOVIL_INVALIDO").length,
    duplicates: input.events.filter((event) => event.reason === "MOVIL_DUPLICADO").length,
    confirmed: input.events.filter((event) => event.reason === "VALIDA" && event.saleStatus === "CONFIRMADA").length,
    ambiguous: input.events.filter((event) => event.reason === "VALIDA" && event.saleStatus === "AMBIGUA").length,
    foundInBases: validMobiles.filter((mobile) => inBase.has(mobile)).length,
    alreadyBlocked: validMobiles.filter((mobile) => alreadyBlocked.has(mobile)).length,
  };
  try {
  await prisma.$transaction(async (tx) => {
      await lockCommercialMobiles(tx, confirmedMobiles);
      await tx.importacionVentas.create({
      data: {
        importacionId: input.importId,
        huellaContenido: input.sourceFingerprint,
        usuarioId: input.userId,
        nombreArchivo: input.fileName,
        periodoDeclarado: input.declaredPeriod,
        resumen: { ...summary, sourceFingerprint: input.sourceFingerprint } as Prisma.InputJsonValue,
        eventos: {
          create: input.events.map((event) => ({
            numeroFilaOrigen: event.sourceRow,
            movilNormalizado: event.mobile,
            fechaVenta: asDate(event.soldAt),
            estado: event.reason === "VALIDA" ? event.saleStatus : "NO_CONFIRMADA",
            estadoOriginal: event.originalStatus || null,
            asesor: event.advisor,
            campana: event.campaign,
            resultadoConciliacion: event.reason === "VALIDA" ? (inBase.has(event.mobile ?? "") ? "ENCONTRADO_EN_BASES" : "NO_ENCONTRADO_EN_BASES") : event.reason,
            metadatos: { version: 1, sourceFingerprint: input.sourceFingerprint, alreadyBlocked: Boolean(event.mobile && alreadyBlocked.has(event.mobile)) },
          })),
        },
      },
      });
    });
  } catch (error) {
    // A simultaneous reimport is harmless: the unique content fingerprint
    // wins and both callers observe the same historical import.
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
    const raced = await prisma.importacionVentas.findUnique({ where: { huellaContenido: input.sourceFingerprint }, select: { resumen: true } });
    if (!raced) throw error;
    return { reused: true, summary: raced.resumen };
  }
  return { reused: false, summary };
}

export async function listExternalSalesImports() {
  return prisma.importacionVentas.findMany({
    orderBy: { creadoEn: "desc" },
    select: { id: true, importacionId: true, nombreArchivo: true, periodoDeclarado: true, creadoEn: true, resumen: true, _count: { select: { eventos: true } } },
    take: 100,
  });
}

/**
 * Aggregated, read-only sales evidence. A sale is linked to an original base
 * or lot only through persisted `lote_registros`; a mobile or an advisor name
 * alone never creates that attribution.
 */
export async function externalSalesDashboard() {
  const sales = await prisma.ventaExterna.findMany({
    where: { estado: "CONFIRMADA", movilNormalizado: { not: null } },
    select: { movilNormalizado: true, asesor: true },
  });
  const mobiles = [...new Set(sales.flatMap((sale) => sale.movilNormalizado ? [sale.movilNormalizado] : []))];
  const relations = mobiles.length ? await prisma.loteRegistro.findMany({
    where: { registro: { movilNormalizado: { in: mobiles } } },
    select: { registro: { select: { movilNormalizado: true } }, lote: { select: { id: true, baseId: true, baseOriginalId: true, campana: true, numeroLote: true } } },
  }) : [];
  const byMobile = new Map<string, { id: string; baseId: string; baseOriginalId: string | null; campaign: string; number: number }[]>();
  for (const relation of relations) {
    const mobile = relation.registro.movilNormalizado;
    if (!mobile) continue;
    byMobile.set(mobile, [...(byMobile.get(mobile) ?? []), { id: relation.lote.id, baseId: relation.lote.baseId, baseOriginalId: relation.lote.baseOriginalId, campaign: relation.lote.campana, number: relation.lote.numeroLote }]);
  }
  const summary = { confirmed: sales.length, withoutDistributionEvidence: 0, attributedToOneLot: 0, ambiguousDistribution: 0 };
  const byLot = new Map<string, { lotId: string; baseOriginalId: string; campaign: string; number: number; confirmedSales: number }>();
  for (const sale of sales) {
    const candidates = [...new Map((byMobile.get(sale.movilNormalizado!) ?? []).map((lot) => [lot.id, lot])).values()];
    if (candidates.length === 0) { summary.withoutDistributionEvidence += 1; continue; }
    if (candidates.length > 1) { summary.ambiguousDistribution += 1; continue; }
    summary.attributedToOneLot += 1;
    const lot = candidates[0]!;
    const current = byLot.get(lot.id) ?? { lotId: lot.id, baseOriginalId: lot.baseOriginalId ?? lot.baseId, campaign: lot.campaign, number: lot.number, confirmedSales: 0 };
    current.confirmedSales += 1;
    byLot.set(lot.id, current);
  }
  const declaredAdvisor = new Map<string, number>();
  for (const sale of sales) if (sale.asesor?.trim()) declaredAdvisor.set(sale.asesor.trim(), (declaredAdvisor.get(sale.asesor.trim()) ?? 0) + 1);
  return {
    summary,
    lots: [...byLot.values()].sort((left, right) => right.confirmedSales - left.confirmedSales || left.lotId.localeCompare(right.lotId)).slice(0, 100),
    // This is source-file metadata, deliberately not an inferred lot owner.
    declaredAdvisors: [...declaredAdvisor].map(([advisor, confirmedSales]) => ({ advisor, confirmedSales })).sort((left, right) => right.confirmedSales - left.confirmedSales || left.advisor.localeCompare(right.advisor, "es")),
  };
}
