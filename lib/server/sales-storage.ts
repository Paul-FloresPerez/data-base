import "server-only";

import { Prisma } from "@/generated/prisma/client";
import type { SalesEventPreview } from "@/lib/sales/sales-import";
import { prisma } from "@/lib/server/prisma";

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
  await prisma.$transaction(async (tx) => {
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
  return { reused: false, summary };
}

export async function listExternalSalesImports() {
  return prisma.importacionVentas.findMany({
    orderBy: { creadoEn: "desc" },
    select: { id: true, importacionId: true, nombreArchivo: true, periodoDeclarado: true, creadoEn: true, resumen: true, _count: { select: { eventos: true } } },
    take: 100,
  });
}
