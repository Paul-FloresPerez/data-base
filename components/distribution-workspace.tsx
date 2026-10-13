"use client";

import { useMemo } from "react";

import { campaignOperatorDefinitions, type CampaignOperatorId, type CampaignReport } from "@/lib/campaigns/campaign-engine";
import { buildExportPlan, MAX_BATCH_SIZE, normalizeBatchSize } from "@/lib/export/xlsx-export";
import type { DistributionSettings } from "@/lib/workspace/batch";

interface DistributionWorkspaceProps {
  onBack: () => void;
  onContinue: () => void;
  onSettingsChange: (settings: DistributionSettings) => void;
  report: CampaignReport;
  settings: DistributionSettings;
}

export function DistributionWorkspace({ onBack, onContinue, onSettingsChange, report, settings }: DistributionWorkspaceProps) {
  const plan = useMemo(
    () => buildExportPlan(report, settings.selectedCampaigns, settings.batchSize),
    [report, settings.batchSize, settings.selectedCampaigns],
  );
  const totalBatches = plan.campaigns.reduce((total, campaign) => total + campaign.batches.length, 0);

  function toggleCampaign(campaign: CampaignOperatorId) {
    const selectedCampaigns = settings.selectedCampaigns.includes(campaign)
      ? settings.selectedCampaigns.filter((item) => item !== campaign)
      : [...settings.selectedCampaigns, campaign];
    onSettingsChange({ ...settings, selectedCampaigns });
  }

  function updateBatchSize(value: string) {
    const parsedValue = Number(value);
    onSettingsChange({
      ...settings,
      batchSize: value === "" || !Number.isFinite(parsedValue) ? 100 : normalizeBatchSize(parsedValue),
    });
  }

  return (
    <section aria-labelledby="distribucion-title" className="space-y-5">
      <div className="flex flex-col gap-4 border-b border-slate-200 pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#174ea6]">Preparación de lotes</p>
          <h2 id="distribucion-title" className="mt-1 text-2xl font-semibold tracking-tight text-[#0f274f] sm:text-3xl">Distribuye la base</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">Define campañas y tamaño de lote antes de generar archivos. Los recuentos responden a los filtros activos de Campañas.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={onBack} className="inline-flex min-h-10 items-center justify-center rounded-md border border-slate-300 bg-white px-3.5 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#174ea6]">Volver a campañas</button>
          <button type="button" disabled={plan.totalEligible === 0} onClick={onContinue} className="inline-flex min-h-10 items-center justify-center rounded-md bg-[#174ea6] px-3.5 text-sm font-semibold text-white transition-colors hover:bg-[#123f87] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#174ea6] disabled:cursor-not-allowed disabled:bg-slate-300">Continuar a exportación</button>
        </div>
      </div>

      <section className="border border-slate-200 bg-white">
        <div className="grid gap-5 px-4 py-4 lg:grid-cols-[minmax(0,1fr)_220px] lg:items-end">
          <fieldset>
            <legend className="text-sm font-semibold text-slate-900">Campañas a distribuir</legend>
            <p className="mt-1 text-xs leading-5 text-slate-500">Solo se incluyen los contactos elegibles en cada oferta.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {campaignOperatorDefinitions.map((campaign) => {
                const checked = settings.selectedCampaigns.includes(campaign.id);
                const summary = plan.campaigns.find((item) => item.campaign === campaign.id);
                return (
                  <label key={campaign.id} className={`cursor-pointer rounded-md border px-3 py-2 text-sm font-semibold transition-colors focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[#174ea6] ${checked ? "border-[#174ea6] bg-blue-50 text-[#174ea6]" : "border-slate-200 bg-white text-slate-700 hover:border-blue-300"}`}>
                    <input type="checkbox" checked={checked} onChange={() => toggleCampaign(campaign.id)} className="sr-only" />
                    {campaign.label} <span className="ml-1 text-xs font-medium">{summary?.eligibleCount ?? 0}</span>
                  </label>
                );
              })}
            </div>
          </fieldset>
          <label className="block text-xs font-semibold text-slate-600">Registros por lote
            <input type="number" min="1" max={MAX_BATCH_SIZE} step="1" value={settings.batchSize} onChange={(event) => updateBatchSize(event.target.value)} className="mt-1.5 block min-h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-800 outline-none focus:border-[#174ea6] focus:ring-2 focus:ring-blue-100" />
            <span className="mt-1 block text-[11px] font-normal text-slate-500">Entre 1 y {MAX_BATCH_SIZE} contactos.</span>
          </label>
        </div>
      </section>

      <section aria-label="Resumen de distribución" className="overflow-hidden border border-slate-200 bg-white">
        <div className="grid divide-y divide-slate-200 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          <div className="px-4 py-3"><p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">Campañas</p><p className="mt-1 text-xl font-semibold tabular-nums text-slate-900">{plan.campaigns.length}</p></div>
          <div className="px-4 py-3"><p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">Elegibles</p><p className="mt-1 text-xl font-semibold tabular-nums text-[#174ea6]">{plan.totalEligible}</p></div>
          <div className="px-4 py-3"><p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">Lotes previstos</p><p className="mt-1 text-xl font-semibold tabular-nums text-slate-900">{totalBatches}</p></div>
        </div>
        {plan.campaigns.length > 0 ? (
          <div className="divide-y divide-slate-100 border-t border-slate-200">
            {plan.campaigns.map((campaign) => (
              <div key={campaign.campaign} className="flex flex-col gap-2 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
                <div><span className="font-semibold text-slate-900">{campaign.folderName}</span><span className="ml-2 text-slate-500">{campaign.eligibleCount} elegibles</span></div>
                <span className="font-mono text-xs text-slate-600">{campaign.batches.length} {campaign.batches.length === 1 ? "lote" : "lotes"}</span>
              </div>
            ))}
          </div>
        ) : null}
      </section>

      {plan.totalEligible === 0 ? <p role="status" className="border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">No hay registros elegibles con la selección y filtros actuales. Ajusta Campañas antes de exportar.</p> : null}
    </section>
  );
}
