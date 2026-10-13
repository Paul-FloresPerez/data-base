"use client";

import { useMemo, useState } from "react";

import { campaignOperatorDefinitions, campaignOperators, type CampaignOperatorId, type CampaignReport } from "@/lib/campaigns/campaign-engine";
import {
  buildExportPlan,
  createCampaignZip,
  createCompleteWorkbook,
  createXlsxWorkbook,
  DEFAULT_BATCH_SIZE,
  MAX_BATCH_SIZE,
  normalizeBatchSize,
  workbookToArray,
} from "@/lib/export/xlsx-export";
import type { EnrichmentOutput } from "@/lib/excel/types";

interface ExportWorkspaceProps {
  output: EnrichmentOutput;
  report: CampaignReport;
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

export function ExportWorkspace({ output, report }: ExportWorkspaceProps) {
  const [selectedCampaigns, setSelectedCampaigns] = useState<CampaignOperatorId[]>([...campaignOperators]);
  const [batchSize, setBatchSize] = useState(DEFAULT_BATCH_SIZE);
  const [status, setStatus] = useState<ExportStatus>({
    message: "Los archivos se generan y descargan únicamente desde este navegador.",
    tone: "idle",
  });
  const plan = useMemo(
    () => buildExportPlan(report, selectedCampaigns, batchSize),
    [batchSize, report, selectedCampaigns],
  );
  const isOutputConsistent =
    output.columns.length > 0 &&
    output.rows.length > 0 &&
    output.rows.every((row) => row.cells.length === output.columns.length);
  const canExportCampaigns = isOutputConsistent && selectedCampaigns.length > 0 && plan.totalEligible > 0;

  function toggleCampaign(campaign: CampaignOperatorId) {
    setSelectedCampaigns((current) =>
      current.includes(campaign)
        ? current.filter((item) => item !== campaign)
        : [...current, campaign],
    );
  }

  function updateBatchSize(value: string) {
    const parsedValue = Number(value);
    setBatchSize(value === "" || !Number.isFinite(parsedValue) ? DEFAULT_BATCH_SIZE : normalizeBatchSize(parsedValue));
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
      setStatus({ message: "Selecciona al menos una campaña con registros elegibles antes de descargar el ZIP.", tone: "error" });
      return;
    }

    setStatus({ message: "Generando ZIP local…", progress: `0 de ${plan.campaigns.reduce((total, campaign) => total + campaign.batches.length, 0)} lotes`, tone: "progress" });

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
      setStatus({ message: "El lote solicitado ya no está disponible. Revisa los filtros y vuelve a intentarlo.", tone: "error" });
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
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-blue-700">Salida local</p>
          <h2 id="exportacion-title" className="mt-1 text-2xl font-semibold tracking-tight text-[#10234a] sm:text-3xl">Exportación</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">Descarga la base enriquecida o lotes de campañas según los filtros activos. No se envía información a ningún servidor.</p>
        </div>
        <span className="inline-flex w-fit rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-bold text-amber-900">SIMULADO · HLR/MNP LOCAL</span>
      </div>

      {!isOutputConsistent ? <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">La salida enriquecida no está disponible o es inconsistente. Completa los pasos anteriores antes de exportar.</div> : null}

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)] sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div><p className="text-sm font-semibold text-slate-900">Base completa</p><p className="mt-1 text-sm text-slate-600">{output.rows.length} registros válidos y enriquecidos, con encabezados y orden originales.</p></div>
          <button type="button" disabled={!isOutputConsistent || status.tone === "progress"} onClick={() => void downloadCompleteBase()} className="inline-flex min-h-10 items-center justify-center rounded-lg border border-blue-200 bg-blue-50 px-4 text-sm font-semibold text-blue-800 transition-colors hover:bg-blue-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:cursor-not-allowed disabled:opacity-60">Descargar Excel completo</button>
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)] sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div><p className="text-sm font-semibold text-slate-900">Lotes de campañas</p><p className="mt-1 text-sm leading-6 text-slate-600">Solo contiene elegibles según los filtros activos. Un móvil puede aparecer en ambas campañas, nunca dos veces en la misma.</p></div>
          <label className="block text-xs font-semibold text-slate-600">Tamaño de lote<input type="number" min="1" max={MAX_BATCH_SIZE} step="1" value={batchSize} onChange={(event) => updateBatchSize(event.target.value)} className="mt-1.5 block min-h-10 w-36 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100" /></label>
        </div>

        <fieldset className="mt-5">
          <legend className="text-sm font-semibold text-slate-800">Campañas incluidas</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {campaignOperatorDefinitions.map((campaign) => {
              const checked = selectedCampaigns.includes(campaign.id);
              const planCampaign = plan.campaigns.find((item) => item.campaign === campaign.id);
              return <label key={campaign.id} className={`cursor-pointer rounded-lg border px-3 py-2 text-sm font-semibold transition-colors focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-blue-600 ${checked ? "border-blue-600 bg-blue-50 text-blue-800" : "border-slate-200 bg-white text-slate-700 hover:border-blue-300"}`}><input type="checkbox" checked={checked} onChange={() => toggleCampaign(campaign.id)} className="sr-only" />{campaign.label} <span className="ml-1 text-xs font-medium">({planCampaign?.eligibleCount ?? 0})</span></label>;
            })}
          </div>
        </fieldset>

        <div className="mt-5 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700"><p><span className="font-semibold">{plan.totalEligible}</span> contactos elegibles en <span className="font-semibold">{plan.campaigns.reduce((total, campaign) => total + campaign.batches.length, 0)}</span> lotes.</p><p className="mt-1 text-xs text-slate-500">Los filtros de operador actual, ubicación y antigüedad configurados en Campañas se aplican a esta salida.</p></div>

        <div className="mt-5 flex flex-wrap gap-3"><button type="button" disabled={!canExportCampaigns || status.tone === "progress"} onClick={() => void downloadZip()} className="inline-flex min-h-10 items-center justify-center rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-blue-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:cursor-not-allowed disabled:bg-slate-300">Descargar ZIP por campañas</button></div>

        {plan.campaigns.some((campaign) => campaign.batches.length > 0) ? <div className="mt-5 border-t border-slate-100 pt-4"><p className="text-sm font-semibold text-slate-800">Lotes individuales</p><div className="mt-3 flex flex-wrap gap-2">{plan.campaigns.flatMap((campaign) => campaign.batches.map((batch) => <button key={`${campaign.campaign}-${batch.index}`} type="button" disabled={status.tone === "progress"} onClick={() => void downloadSingleBatch(campaign.campaign, batch.index)} className="min-h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 transition-colors hover:border-blue-300 hover:bg-blue-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:cursor-not-allowed disabled:opacity-60">{campaign.folderName}/{batch.fileName} · {batch.rows.length}</button>))}</div></div> : null}
      </section>

      <p aria-live="polite" className={`rounded-lg px-4 py-3 text-sm ${status.tone === "error" ? "border border-rose-200 bg-rose-50 text-rose-900" : status.tone === "success" ? "border border-emerald-200 bg-emerald-50 text-emerald-900" : status.tone === "progress" ? "border border-blue-200 bg-blue-50 text-blue-900" : "border border-slate-200 bg-slate-50 text-slate-600"}`}>{status.message}{status.progress ? ` ${status.progress}.` : ""}</p>
    </section>
  );
}
