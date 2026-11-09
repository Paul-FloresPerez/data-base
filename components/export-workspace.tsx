"use client";

import { useMemo, useState } from "react";

import type { CampaignOperatorId, CampaignReport } from "@/lib/campaigns/campaign-engine";
import {
  buildExportPlan,
  createCampaignZip,
  createCompleteWorkbook,
  createSingleCampaignZip,
  createXlsxWorkbook,
  projectExportPlan,
  workbookToArray,
} from "@/lib/export/xlsx-export";
import { assertCrmRecyclingContract, buildCrmRecyclingOutput } from "@/lib/export/crm-recycling-export";
import type { EnrichmentOutput } from "@/lib/excel/types";
import type { BatchSummary, DistributionSettings, RecordProvenance } from "@/lib/workspace/batch";

interface ExportWorkspaceProps {
  onBack: () => void;
  onExportCompleted: () => void;
  output: EnrichmentOutput;
  masterOutput: EnrichmentOutput;
  report: CampaignReport;
  settings: DistributionSettings;
  provenances?: RecordProvenance[];
  batch: BatchSummary;
}

interface ExportStatus {
  message: string;
  progress?: string;
  tone: "error" | "idle" | "progress" | "success";
}

function triggerDownload(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export function ExportWorkspace({ batch, masterOutput, onBack, onExportCompleted, output, report, settings, provenances = [] }: ExportWorkspaceProps) {
  const provenanceLabel = provenances.includes("MOCK")
    ? "MOCK · DATOS SIMULADOS"
    : provenances.includes("CRM")
      ? "CRM · REQUIERE REVISIÓN"
      : provenances.includes("API_REAL")
        ? "API REAL"
        : "EXCEL · SIN HLR";
  const [status, setStatus] = useState<ExportStatus>({
    message: "Los archivos se generan y descargan únicamente desde este navegador.",
    tone: "idle",
  });
  const campaignOutput = useMemo(() => batch.kind === "RECICLADA" ? buildCrmRecyclingOutput(output) : output, [batch.kind, output]);
  const plan = useMemo(() => projectExportPlan(buildExportPlan(report, settings.selectedCampaigns, settings.batchSize, settings.shuffleSeed), campaignOutput), [campaignOutput, report, settings.batchSize, settings.selectedCampaigns, settings.shuffleSeed]);
  const crmContractValid = useMemo(() => {
    if (batch.kind !== "RECICLADA") return true;
    try { assertCrmRecyclingContract(campaignOutput); return true; } catch { return false; }
  }, [batch.kind, campaignOutput]);
  const isOutputConsistent =
    output.columns.length > 0 &&
    output.rows.length > 0 &&
    output.rows.every((row) => row.cells.length === output.columns.length) && crmContractValid;
  const canExportCampaigns = isOutputConsistent && settings.selectedCampaigns.length > 0 && plan.totalEligible > 0;
  const totalBatches = plan.campaigns.reduce((total, campaign) => total + campaign.batches.length, 0);

  async function downloadConfirmedCommercial(campaign?: string, lotNumber?: number) {
    const query = new URLSearchParams();
    if (campaign) query.set("campaign", campaign);
    if (lotNumber) query.set("lot", String(lotNumber));
    const response = await fetch(`/api/exportaciones/comerciales/${batch.id}?${query.toString()}`);
    if (!response.ok) throw new Error("La distribución confirmada ya no está disponible.");
    const blob = await response.blob();
    const disposition = response.headers.get("content-disposition") ?? "";
    const fileName = /filename=\"([^\"]+)\"/.exec(disposition)?.[1] ?? "LOTES_COMERCIALES_CONFIRMADOS.zip";
    triggerDownload(blob, fileName);
  }

  async function downloadCompleteBase() {
    if (!isOutputConsistent) {
      setStatus({ message: "No hay una base enriquecida válida para exportar.", tone: "error" });
      return;
    }

    setStatus({ message: "Preparando la base completa…", tone: "progress" });

    try {
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
      const xlsx = await import("xlsx");
      const workbook = createCompleteWorkbook(xlsx, masterOutput);
      const bytes = workbookToArray(xlsx, workbook);
      triggerDownload(
        new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
        "BASE_COMPLETA_ENRIQUECIDA.xlsx",
      );
      onExportCompleted();
      setStatus({ message: "Base completa preparada para descargar.", tone: "success" });
    } catch {
      setStatus({ message: "No se pudo generar el Excel completo.", tone: "error" });
    }
  }

  async function downloadZip() {
    if (!canExportCampaigns) {
      setStatus({ message: "Configura una campaña con registros elegibles antes de descargar el ZIP.", tone: "error" });
      return;
    }

    setStatus({ message: "Generando ZIP local…", progress: `0 de ${totalBatches} lotes`, tone: "progress" });

    try {
      const [xlsx, JSZipModule] = await Promise.all([import("xlsx"), import("jszip")]);
      const archive = await createCampaignZip(
        xlsx,
        new JSZipModule.default(),
        masterOutput,
        plan,
        { baseId: batch.id, baseName: batch.displayName ?? batch.fileName, filters: settings, generatedAt: new Date().toISOString() },
        (completed, total) => setStatus({ message: "Generando ZIP local de vista previa…", progress: `${completed} de ${total} lotes`, tone: "progress" }),
        campaignOutput,
      );
      triggerDownload(archive, "VISTA_PREVIA_CAMPANAS.zip");
      onExportCompleted();
      setStatus({ message: "ZIP local de vista previa preparado. No confirma ni reserva móviles.", tone: "success" });
    } catch {
      setStatus({ message: "No se pudo generar el ZIP de campañas.", tone: "error" });
    }
  }

  async function downloadCampaign(campaignId: CampaignOperatorId) {
    const campaign = plan.campaigns.find((item) => item.campaign === campaignId);
    if (!campaign || !campaign.batches.length || !isOutputConsistent) {
      setStatus({ message: "La campaña solicitada no contiene lotes exportables.", tone: "error" });
      return;
    }
    setStatus({ message: `Generando ZIP de ${campaign.folderName}…`, progress: `0 de ${campaign.batches.length} lotes`, tone: "progress" });
    try {
      const [xlsx, JSZipModule] = await Promise.all([import("xlsx"), import("jszip")]);
      const archive = await createSingleCampaignZip(
        xlsx,
        new JSZipModule.default(),
        campaignOutput,
        campaign,
        { baseId: batch.id, baseName: batch.displayName ?? batch.fileName, filters: settings, generatedAt: new Date().toISOString() },
        (completed, total) => setStatus({ message: `Generando ZIP local de vista previa de ${campaign.folderName}…`, progress: `${completed} de ${total} lotes`, tone: "progress" }),
      );
      triggerDownload(archive, `VISTA_PREVIA_${campaign.folderName}.zip`);
      onExportCompleted();
      setStatus({ message: `ZIP local de vista previa de ${campaign.folderName} preparado. No confirma ni reserva móviles.`, tone: "success" });
    } catch {
      setStatus({ message: `No se pudo generar el ZIP de ${campaign.folderName}.`, tone: "error" });
    }
  }

  async function downloadSingleBatch(campaignId: CampaignOperatorId, batchIndex: number) {
    const campaign = plan.campaigns.find((item) => item.campaign === campaignId);
    const batch = campaign?.batches.find((item) => item.index === batchIndex);

    if (!campaign || !batch || !isOutputConsistent) {
      setStatus({ message: "El lote solicitado ya no está disponible. Revisa la distribución y vuelve a intentarlo.", tone: "error" });
      return;
    }

    setStatus({ message: `Preparando ${campaign.folderName}/${batch.fileName}…`, tone: "progress" });

    try {
      const xlsx = await import("xlsx");
      const workbook = createXlsxWorkbook(xlsx, campaignOutput.columns, batch.rows, campaign.folderName);
      triggerDownload(
        new Blob([workbookToArray(xlsx, workbook)], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
        `${campaign.folderName}_${batch.fileName}`,
      );
      onExportCompleted();
      setStatus({ message: `${campaign.folderName}/${batch.fileName} preparado como vista previa local. No confirma ni reserva móviles.`, tone: "success" });
    } catch {
      setStatus({ message: "No se pudo generar el lote seleccionado.", tone: "error" });
    }
  }

  return (
    <section aria-labelledby="exportacion-title" className="space-y-5">
      <div className="flex flex-col gap-4 border-b border-slate-200 pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#174ea6]">Vista previa local</p>
          <h2 id="exportacion-title" className="mt-1 text-2xl font-semibold tracking-tight text-[#0f274f] sm:text-3xl">Exporta la base</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">{batch.kind === "RECICLADA" ? "Los lotes CRM usan el contrato fijo de 24 encabezados; la base maestra mantiene su estructura interna original." : "Los archivos conservan los encabezados, el orden original y la procedencia de los registros."}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={onBack} className="inline-flex min-h-10 items-center justify-center rounded-md border border-slate-300 bg-white px-3.5 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#174ea6]">Ajustar distribución</button>
          <span className="inline-flex w-fit items-center rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-bold text-amber-900">{provenanceLabel}</span>
        </div>
      </div>

      <section className="border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700"><p><span className="font-semibold text-slate-900">Base:</span> {batch.displayName ?? batch.fileName} · {batch.kind} · <span className="font-mono text-xs">{batch.id.slice(0, 8)}</span></p><p className="mt-1 text-xs">{plan.campaigns.map((campaign) => `${campaign.campaign.toUpperCase()}: ${campaign.eligibleCount} registros / ${campaign.batches.length} lotes`).join(" · ") || "Sin campañas seleccionadas"} · Filtros aplicados en Campañas.</p></section>

      {!isOutputConsistent ? <div role="alert" className="border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">{batch.kind === "RECICLADA" ? "La estructura CRM de 24 columnas no pudo validarse. No se generará ningún lote." : "La salida enriquecida no está disponible o es inconsistente. Completa los pasos anteriores antes de exportar."}</div> : null}

      <section className="overflow-hidden border border-slate-200 bg-white">
        <div className="flex flex-col gap-4 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div><p className="text-sm font-semibold text-slate-900">Base maestra</p><p className="mt-1 text-sm text-slate-600">{masterOutput.rows.length} registros originales, incluidos los excluidos, con todas sus columnas y enriquecimiento disponible. No es una lista de campaña{batch.kind === "RECICLADA" ? " ni una plantilla CRM" : ""}.</p></div>
          <button type="button" disabled={!isOutputConsistent || status.tone === "progress"} onClick={() => void downloadCompleteBase()} className="inline-flex min-h-10 items-center justify-center rounded-md border border-[#174ea6] bg-white px-3.5 text-sm font-semibold text-[#174ea6] transition-colors hover:bg-blue-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#174ea6] disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400">Descargar BASE_MAESTRA.xlsx</button>
        </div>
      </section>

      <section className="overflow-hidden border border-slate-200 bg-white">
        <div className="flex flex-col gap-3 border-b border-slate-200 px-4 py-4 sm:flex-row sm:items-start sm:justify-between">
          <div><p className="text-sm font-semibold text-slate-900">Vista previa por campañas</p><p className="mt-1 text-sm leading-6 text-slate-600">Un ZIP local incluye BASE_MAESTRA.xlsx, MANIFIESTO.xlsx y carpetas YOIGO/VODAFONE con lotes de hasta {settings.batchSize} registros{batch.kind === "RECICLADA" ? " en formato CRM de 24 columnas" : ""}. No crea reservas ni confirma una distribución comercial.</p></div>
          <button type="button" disabled={!canExportCampaigns || status.tone === "progress"} onClick={() => void downloadZip()} className="inline-flex min-h-10 items-center justify-center rounded-md bg-[#174ea6] px-3.5 text-sm font-semibold text-white transition-colors hover:bg-[#123f87] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#174ea6] disabled:cursor-not-allowed disabled:bg-slate-300">Descargar ZIP de vista previa</button>
        </div>
        <div className="grid divide-y divide-slate-200 sm:grid-cols-4 sm:divide-x sm:divide-y-0">
          <div className="px-4 py-3"><p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">Móviles únicos</p><p className="mt-1 text-xl font-semibold tabular-nums text-[#174ea6]">{plan.uniqueEligibleCount}</p></div>
          <div className="px-4 py-3"><p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">Asignaciones</p><p className="mt-1 text-xl font-semibold tabular-nums text-slate-900">{plan.totalEligible}</p></div>
          <div className="px-4 py-3"><p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">Conflictos</p><p className="mt-1 text-xl font-semibold tabular-nums text-amber-700">{plan.conflictCount}</p></div>
          <div className="px-4 py-3"><p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">Lotes</p><p className="mt-1 text-xl font-semibold tabular-nums text-slate-900">{totalBatches}</p></div>
        </div>
        {plan.conflictCount > 0 ? <p role="status" className="border-t border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">{plan.conflictCount} móviles son elegibles en más de una campaña. No hay una regla de exclusividad comercial configurada: el ZIP conserva ambas candidaturas para decisión humana, sin duplicarlos dentro de cada campaña.</p> : null}
        {plan.campaigns.some((campaign) => campaign.batches.length > 0) ? <div className="border-t border-slate-200 px-4 py-4"><p className="text-xs font-semibold uppercase tracking-[0.1em] text-slate-500">Descargas locales de vista previa</p><div className="mt-3 flex flex-wrap gap-2">{plan.campaigns.filter((campaign) => campaign.batches.length > 0).map((campaign) => <button key={`${campaign.campaign}-zip`} type="button" disabled={status.tone === "progress"} onClick={() => void downloadCampaign(campaign.campaign)} className="min-h-8 rounded-md border border-[#174ea6] bg-white px-2.5 text-xs font-semibold text-[#174ea6] transition-colors hover:bg-blue-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#174ea6] disabled:cursor-not-allowed disabled:opacity-60">ZIP de vista previa {campaign.folderName} · {campaign.eligibleCount} registros</button>)}{plan.campaigns.flatMap((campaign) => campaign.batches.map((batch) => <button key={`${campaign.campaign}-${batch.index}`} type="button" disabled={status.tone === "progress"} onClick={() => void downloadSingleBatch(campaign.campaign, batch.index)} className="min-h-8 rounded-md border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-700 transition-colors hover:border-blue-300 hover:bg-blue-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#174ea6] disabled:cursor-not-allowed disabled:opacity-60">Vista previa {campaign.folderName} · lote {batch.index} · {batch.rows.length} registros</button>))}</div></div> : <p className="px-4 py-4 text-sm text-slate-500">No hay lotes preparados con los filtros y campañas actuales.</p>}
      </section>

      <section className="border border-slate-200 bg-slate-50 px-4 py-4">
        <p className="text-sm font-semibold text-slate-900">Descarga comercial confirmada</p>
        <p className="mt-1 text-xs leading-5 text-slate-600">Solo está disponible después de confirmar la distribución en el paso anterior. El servidor usa exclusivamente los lotes persistidos y sus reservas activas.</p>
        <button type="button" disabled={!batch.commercialDistributionConfirmed || status.tone === "progress"} onClick={() => void downloadConfirmedCommercial()} className="mt-3 inline-flex min-h-10 items-center justify-center rounded-md border border-emerald-700 bg-white px-3.5 text-sm font-semibold text-emerald-800 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400">Descargar ZIP comercial confirmado</button>
      </section>

      <p aria-live="polite" className={`border px-4 py-3 text-sm ${status.tone === "error" ? "border-rose-200 bg-rose-50 text-rose-900" : status.tone === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-900" : status.tone === "progress" ? "border-blue-200 bg-blue-50 text-blue-900" : "border-slate-200 bg-white text-slate-600"}`}>{status.message}{status.progress ? ` ${status.progress}.` : ""}</p>
    </section>
  );
}
