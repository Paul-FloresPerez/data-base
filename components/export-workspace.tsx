"use client";

import { useMemo, useState } from "react";

import type { CampaignOperatorId, CampaignReport } from "@/lib/campaigns/campaign-engine";
import {
  buildExportPlan,
  createCampaignZip,
  createCompleteWorkbook,
  createXlsxWorkbook,
  workbookToArray,
} from "@/lib/export/xlsx-export";
import type { EnrichmentOutput } from "@/lib/excel/types";
import type { BatchSummary, DistributionSettings, RecordProvenance } from "@/lib/workspace/batch";

interface ExportWorkspaceProps {
  onBack: () => void;
  output: EnrichmentOutput;
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

export function ExportWorkspace({ batch, onBack, output, report, settings, provenances = [] }: ExportWorkspaceProps) {
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
  const plan = useMemo(
    () => buildExportPlan(report, settings.selectedCampaigns, settings.batchSize),
    [report, settings.batchSize, settings.selectedCampaigns],
  );
  const isOutputConsistent =
    output.columns.length > 0 &&
    output.rows.length > 0 &&
    output.rows.every((row) => row.cells.length === output.columns.length);
  const canExportCampaigns = isOutputConsistent && settings.selectedCampaigns.length > 0 && plan.totalEligible > 0;
  const totalBatches = plan.campaigns.reduce((total, campaign) => total + campaign.batches.length, 0);

  async function downloadCompleteBase() {
    if (!isOutputConsistent) {
      setStatus({ message: "No hay una base enriquecida válida para exportar.", tone: "error" });
      return;
    }

    setStatus({ message: "Preparando la base completa…", tone: "progress" });

    try {
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
      const xlsx = await import("xlsx");
      const workbook = createCompleteWorkbook(xlsx, output);
      const bytes = workbookToArray(xlsx, workbook);
      triggerDownload(
        new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
        "BASE_COMPLETA_ENRIQUECIDA.xlsx",
      );
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
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
      const [xlsx, jszip] = await Promise.all([import("xlsx"), import("jszip")]);
      const zip = new jszip.default();
      const zipBlob = await createCampaignZip(xlsx, zip, output.columns, plan, (completed, total) => {
        setStatus({ message: "Generando ZIP local…", progress: `${completed} de ${total} lotes`, tone: "progress" });
      });
      triggerDownload(zipBlob, "CAMPANAS_YOIGO_VODAFONE.zip");
      setStatus({ message: "ZIP preparado para descargar.", tone: "success" });
    } catch {
      setStatus({ message: "No se pudo generar el ZIP de campañas.", tone: "error" });
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
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
      const xlsx = await import("xlsx");
      const workbook = createXlsxWorkbook(xlsx, output.columns, batch.rows, campaign.folderName);
      const bytes = workbookToArray(xlsx, workbook);
      triggerDownload(
        new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
        `${campaign.folderName}_${batch.fileName}`,
      );
      setStatus({ message: `${campaign.folderName}/${batch.fileName} preparado para descargar.`, tone: "success" });
    } catch {
      setStatus({ message: "No se pudo generar el lote seleccionado.", tone: "error" });
    }
  }

  return (
    <section aria-labelledby="exportacion-title" className="space-y-5">
      <div className="flex flex-col gap-4 border-b border-slate-200 pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#174ea6]">Salida local</p>
          <h2 id="exportacion-title" className="mt-1 text-2xl font-semibold tracking-tight text-[#0f274f] sm:text-3xl">Exporta la base</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">Los archivos conservan los encabezados, el orden original y la procedencia de los registros.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={onBack} className="inline-flex min-h-10 items-center justify-center rounded-md border border-slate-300 bg-white px-3.5 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#174ea6]">Ajustar distribución</button>
          <span className="inline-flex w-fit items-center rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-bold text-amber-900">{provenanceLabel}</span>
        </div>
      </div>

      <section className="border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700"><p><span className="font-semibold text-slate-900">Base:</span> {batch.fileName} · {batch.kind} · <span className="font-mono text-xs">{batch.id.slice(0, 8)}</span></p><p className="mt-1 text-xs">{plan.campaigns.map((campaign) => `${campaign.campaign.toUpperCase()}: ${campaign.eligibleCount} registros / ${campaign.batches.length} lotes`).join(" · ") || "Sin campañas seleccionadas"} · Filtros aplicados en Campañas.</p></section>

      {!isOutputConsistent ? <div role="alert" className="border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">La salida enriquecida no está disponible o es inconsistente. Completa los pasos anteriores antes de exportar.</div> : null}

      <section className="overflow-hidden border border-slate-200 bg-white">
        <div className="flex flex-col gap-4 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div><p className="text-sm font-semibold text-slate-900">Base completa</p><p className="mt-1 text-sm text-slate-600">{output.rows.length} registros válidos y enriquecidos, con la estructura del Excel original.</p></div>
          <button type="button" disabled={!isOutputConsistent || status.tone === "progress"} onClick={() => void downloadCompleteBase()} className="inline-flex min-h-10 items-center justify-center rounded-md border border-[#174ea6] bg-white px-3.5 text-sm font-semibold text-[#174ea6] transition-colors hover:bg-blue-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#174ea6] disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400">Descargar Excel completo</button>
        </div>
      </section>

      <section className="overflow-hidden border border-slate-200 bg-white">
        <div className="flex flex-col gap-3 border-b border-slate-200 px-4 py-4 sm:flex-row sm:items-start sm:justify-between">
          <div><p className="text-sm font-semibold text-slate-900">Archivos por campaña</p><p className="mt-1 text-sm leading-6 text-slate-600">{settings.selectedCampaigns.length} campañas seleccionadas · hasta {settings.batchSize} registros por lote.</p></div>
          <button type="button" disabled={!canExportCampaigns || status.tone === "progress"} onClick={() => void downloadZip()} className="inline-flex min-h-10 items-center justify-center rounded-md bg-[#174ea6] px-3.5 text-sm font-semibold text-white transition-colors hover:bg-[#123f87] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#174ea6] disabled:cursor-not-allowed disabled:bg-slate-300">Descargar ZIP</button>
        </div>
        <div className="grid divide-y divide-slate-200 sm:grid-cols-2 sm:divide-x sm:divide-y-0">
          <div className="px-4 py-3"><p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">Elegibles</p><p className="mt-1 text-xl font-semibold tabular-nums text-[#174ea6]">{plan.totalEligible}</p></div>
          <div className="px-4 py-3"><p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">Lotes</p><p className="mt-1 text-xl font-semibold tabular-nums text-slate-900">{totalBatches}</p></div>
        </div>
        {plan.campaigns.some((campaign) => campaign.batches.length > 0) ? <div className="border-t border-slate-200 px-4 py-4"><p className="text-xs font-semibold uppercase tracking-[0.1em] text-slate-500">Descarga individual</p><div className="mt-3 flex flex-wrap gap-2">{plan.campaigns.flatMap((campaign) => campaign.batches.map((batch) => <button key={`${campaign.campaign}-${batch.index}`} type="button" disabled={status.tone === "progress"} onClick={() => void downloadSingleBatch(campaign.campaign, batch.index)} className="min-h-8 rounded-md border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-700 transition-colors hover:border-blue-300 hover:bg-blue-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#174ea6] disabled:cursor-not-allowed disabled:opacity-60">{campaign.folderName}/{batch.fileName} · {batch.rows.length}</button>))}</div></div> : <p className="px-4 py-4 text-sm text-slate-500">No hay lotes preparados con los filtros y campañas actuales.</p>}
      </section>

      <p aria-live="polite" className={`border px-4 py-3 text-sm ${status.tone === "error" ? "border-rose-200 bg-rose-50 text-rose-900" : status.tone === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-900" : status.tone === "progress" ? "border-blue-200 bg-blue-50 text-blue-900" : "border-slate-200 bg-white text-slate-600"}`}>{status.message}{status.progress ? ` ${status.progress}.` : ""}</p>
    </section>
  );
}
