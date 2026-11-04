import JSZip from "jszip";
import * as XLSX from "xlsx";

import { createManifestWorkbook, createXlsxWorkbook, workbookToArray, type ExportPlan } from "@/lib/export/xlsx-export";
import { buildCrmRecyclingOutput } from "@/lib/export/crm-recycling-export";
import { prepareCommercialExport } from "@/lib/server/commercial-export-storage";
import { uuidPattern } from "@/lib/server/request-validation";
import { requireAdminApi } from "@/lib/server/require-admin";

const contentType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function attachment(body: ArrayBuffer, fileName: string, type = contentType) {
  return new Response(body, { headers: { "content-type": type, "content-disposition": `attachment; filename=\"${fileName}\"`, "cache-control": "no-store" } });
}

export async function GET(request: Request, { params }: { params: Promise<{ baseId: string }> }) {
  const session = await requireAdminApi();
  if (!session?.user?.id) return Response.json({ error: "No autorizado" }, { status: 401 });
  const { baseId } = await params;
  const query = new URL(request.url).searchParams;
  const campaign = query.get("campaign");
  const lotRaw = query.get("lot");
  const lotNumber = lotRaw === null ? null : Number(lotRaw);
  if (!uuidPattern.test(baseId) || (campaign !== null && campaign !== "YOIGO" && campaign !== "VODAFONE") || (lotNumber !== null && (!Number.isInteger(lotNumber) || lotNumber < 1))) {
    return Response.json({ error: "Solicitud de exportación comercial no válida." }, { status: 400 });
  }
  try {
    const snapshot = await prepareCommercialExport({ baseId, userId: session.user.id, campaign: campaign as "YOIGO" | "VODAFONE" | undefined, lotNumber: lotNumber ?? undefined });
    const project = (rows: { sourceRow: number; cells: string[] }[]) => snapshot.kind === "RECICLADA"
      ? buildCrmRecyclingOutput({ columns: snapshot.columns, rows })
      : { columns: snapshot.columns, rows };
    if (lotNumber) {
      const lot = snapshot.lots[0]!;
      const output = project(lot.rows);
      return attachment(workbookToArray(XLSX, createXlsxWorkbook(XLSX, output.columns, output.rows, lot.campaign)), `${lot.campaign}_LOTE_${String(lot.number).padStart(3, "0")}.xlsx`);
    }
    const zip = new JSZip();
    const campaigns = snapshot.lots.reduce<Map<string, typeof snapshot.lots>>((result, lot) => {
      const lots = result.get(lot.campaign) ?? [];
      lots.push(lot);
      result.set(lot.campaign, lots);
      return result;
    }, new Map());
    const plan: ExportPlan = { campaigns: [], totalEligible: 0, uniqueEligibleCount: 0, conflictCount: 0 };
    for (const [campaignName, lots] of campaigns) {
      const folder = zip.folder(campaignName)!;
      for (const lot of lots) {
        const output = project(lot.rows);
        const fileName = `LOTE_${String(lot.number).padStart(3, "0")}.xlsx`;
        folder.file(fileName, workbookToArray(XLSX, createXlsxWorkbook(XLSX, output.columns, output.rows, campaignName)));
      }
      const total = lots.reduce((count, lot) => count + lot.rows.length, 0);
      plan.campaigns.push({ campaign: campaignName.toLocaleLowerCase("es-ES") as "yoigo" | "vodafone", folderName: campaignName, eligibleCount: total, batches: lots.map((lot) => ({ index: lot.number, fileName: `LOTE_${String(lot.number).padStart(3, "0")}.xlsx`, rows: lot.rows })) });
      plan.totalEligible += total;
    }
    plan.uniqueEligibleCount = new Set(snapshot.lots.flatMap((lot) => lot.rows.map((row) => row.sourceRow))).size;
    zip.file("MANIFIESTO.xlsx", workbookToArray(XLSX, createManifestWorkbook(XLSX, plan, { baseId, baseName: snapshot.baseName, generatedAt: new Date().toISOString(), filters: { source: "reservas_activas_confirmadas" } })));
    return attachment(await zip.generateAsync({ type: "arraybuffer" }), campaign ? `${campaign}_LOTES_CONFIRMADOS.zip` : "LOTES_COMERCIALES_CONFIRMADOS.zip", "application/zip");
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "No se pudo preparar una descarga comercial confirmada." }, { status: 409 });
  }
}
