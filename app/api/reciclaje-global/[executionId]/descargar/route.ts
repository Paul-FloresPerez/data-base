import * as XLSX from "xlsx";

import { CRM_RECYCLING_HEADERS, assertCrmRecyclingContract } from "@/lib/export/crm-recycling-export";
import { prisma } from "@/lib/server/prisma";
import { uuidPattern } from "@/lib/server/request-validation";
import { requireAdminApi } from "@/lib/server/require-admin";

export async function GET(_: Request, context: { params: Promise<{ executionId: string }> }) {
  if (!await requireAdminApi()) return Response.json({ error: "No autorizado" }, { status: 401 });
  const { executionId } = await context.params;
  if (!uuidPattern.test(executionId)) return Response.json({ error: "Ejecución no válida." }, { status: 400 });
  const execution = await prisma.ejecucionReciclajeGlobal.findUnique({ where: { id: executionId }, select: { baseReciclada: { include: { registros: { orderBy: { numeroFilaOriginal: "asc" } } } } } });
  if (!execution?.baseReciclada) return Response.json({ error: "La ejecución todavía no tiene una base reciclada disponible." }, { status: 409 });
  const rows = execution.baseReciclada.registros.map((record) => {
    const original = record.datosOriginales as { enrichedCells?: unknown; cells?: unknown };
    const cells = Array.isArray(original.enrichedCells) ? original.enrichedCells.map(String) : Array.isArray(original.cells) ? original.cells.map(String) : [];
    return { sourceRow: record.numeroFilaOriginal, cells };
  });
  const output = { columns: [...CRM_RECYCLING_HEADERS], rows };
  assertCrmRecyclingContract(output);
  const sheet = XLSX.utils.aoa_to_sheet([output.columns, ...output.rows.map((row) => row.cells)]);
  const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, sheet, "Datos");
  const bytes = XLSX.write(book, { bookType: "xlsx", type: "array", compression: true }) as ArrayBuffer;
  return new Response(bytes, { headers: { "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "content-disposition": `attachment; filename="RECICLAJE_GLOBAL_${executionId.slice(0, 8)}.xlsx"` } });
}
