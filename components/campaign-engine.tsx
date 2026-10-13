"use client";

import { useMemo, useState } from "react";

import { DataTable } from "@/components/data-table";
import {
  buildCampaignReport,
  campaignFilterReasonLabels,
  campaignOperatorDefinitions,
  campaignOperators,
  permanenceStatus,
  type CampaignBreakdown,
  type CampaignFilters,
  type CampaignOperatorId,
  type GeographicFilters,
} from "@/lib/campaigns/campaign-engine";
import type { EnrichmentOutput } from "@/lib/excel/types";

interface CampaignEngineProps {
  filters: CampaignFilters;
  onFiltersChange: (nextFilters: CampaignFilters) => void;
  output: EnrichmentOutput;
}

function CampaignSummaryCard({
  campaign,
  selected,
  filteredOut,
  onSelect,
}: {
  campaign: CampaignBreakdown;
  filteredOut: number;
  onSelect: () => void;
  selected: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`w-full rounded-xl border bg-white p-4 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 ${selected ? "border-blue-600 ring-1 ring-blue-600" : "border-slate-200 hover:border-blue-300"}`}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="text-base font-semibold text-slate-900">{campaign.operator.label}</span>
        <span className={`h-2.5 w-2.5 rounded-full ${selected ? "bg-blue-600" : "bg-slate-300"}`} aria-hidden="true" />
      </div>
      <p className="mt-1 text-xs text-slate-500">{campaign.totalCleanRecords} tras filtros · {filteredOut} excluidos por filtros</p>
      <dl className="mt-4 grid grid-cols-3 divide-x divide-slate-100 text-center text-xs">
        <div className="px-1"><dt className="text-slate-500">Elegibles</dt><dd className="mt-1 font-semibold text-emerald-700">{campaign.eligible.length}</dd></div>
        <div className="px-1"><dt className="text-slate-500">Mismo operador</dt><dd className="mt-1 font-semibold text-rose-700">{campaign.excludedByOperator.length}</dd></div>
        <div className="px-1"><dt className="text-slate-500">Sin clasificar</dt><dd className="mt-1 font-semibold text-amber-700">{campaign.unclassified.length}</dd></div>
      </dl>
    </button>
  );
}

export function CampaignEngine({ filters, onFiltersChange, output }: CampaignEngineProps) {
  const [selectedOperators, setSelectedOperators] = useState<CampaignOperatorId[]>([...campaignOperators]);
  const [activeCampaignId, setActiveCampaignId] = useState<CampaignOperatorId>(campaignOperators[0]);
  const report = useMemo(() => buildCampaignReport(output, selectedOperators, filters), [filters, output, selectedOperators]);
  const activeCampaign = report.campaigns.find((campaign) => campaign.operator.id === activeCampaignId) ?? report.campaigns[0];
  const activeFilterReasons = Object.entries(report.filterSummary.reasonBreakdown).filter(([, count]) => count > 0);
  const detailColumns = report.columnMapping.permanencia === undefined ? [...report.columns, "Permanencia"] : [...report.columns];

  function toggleCampaign(operator: CampaignOperatorId) {
    setSelectedOperators((current) =>
      current.includes(operator)
        ? current.filter((item) => item !== operator)
        : [...current, operator],
    );
  }

  function updateGeographicFilter(field: keyof GeographicFilters, value: string) {
    onFiltersChange({ ...filters, [field]: value });
  }

  function toggleCurrentOperator(value: string) {
    const currentValues = filters.currentOperatorValues ?? [];
    const nextValues = currentValues.includes(value)
      ? currentValues.filter((item) => item !== value)
      : [...currentValues, value];
    onFiltersChange({ ...filters, currentOperatorValues: nextValues });
  }

  function updateMinimumAge(value: string) {
    const parsedValue = Number(value);
    onFiltersChange({
      ...filters,
      minimumPortabilityMonths: value === "" || !Number.isFinite(parsedValue) ? undefined : Math.max(0, Math.floor(parsedValue)),
    });
  }

  function clearFilters() {
    onFiltersChange({ includeWithoutPortabilityDate: true });
  }

  return (
    <section aria-labelledby="campanas-title" className="space-y-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-blue-700">Segmentación comercial</p>
          <h2 id="campanas-title" className="mt-1 text-2xl font-semibold tracking-tight text-[#10234a] sm:text-3xl">Campañas Yoigo y Vodafone</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">La elegibilidad se calcula exclusivamente con <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">operador_actual</code>. Los campos provenientes del mock continúan señalados como simulados.</p>
        </div>
        <span className="inline-flex w-fit rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-bold text-amber-900">SIMULADO · HLR/MNP LOCAL</span>
      </div>

      {report.columnMapping.operador_actual === undefined ? <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">No se encontró “Operador Actual”. Los registros filtrados se mostrarán como Sin clasificar y el filtro de operador actual no estará disponible.</p> : null}

      <fieldset className="rounded-xl border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
        <legend className="px-1 text-sm font-semibold text-slate-800">Ofertas comerciales</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {campaignOperatorDefinitions.map((operator) => {
            const checked = selectedOperators.includes(operator.id);
            return (
              <label key={operator.id} className={`cursor-pointer rounded-lg border px-3 py-2 text-sm font-semibold transition-colors focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-blue-600 ${checked ? "border-blue-600 bg-blue-50 text-blue-800" : "border-slate-200 bg-white text-slate-700 hover:border-blue-300"}`}>
                <input type="checkbox" checked={checked} onChange={() => toggleCampaign(operator.id)} className="sr-only" />
                {operator.label}
              </label>
            );
          })}
        </div>
      </fieldset>

      <fieldset className="rounded-xl border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
        <legend className="px-1 text-sm font-semibold text-slate-800">Filtros opcionales</legend>
        <div className="mt-2 grid gap-3 md:grid-cols-3">
          <label className="text-xs font-semibold text-slate-600">Provincia<input type="text" value={filters.provincia ?? ""} onChange={(event) => updateGeographicFilter("provincia", event.target.value)} disabled={report.columnMapping.provincia === undefined} placeholder={report.columnMapping.provincia === undefined ? "Columna no disponible" : "Ej. Madrid"} className="mt-1.5 block min-h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-slate-100" /></label>
          <label className="text-xs font-semibold text-slate-600">Localidad<input type="text" value={filters.localidad ?? ""} onChange={(event) => updateGeographicFilter("localidad", event.target.value)} disabled={report.columnMapping.localidad === undefined} placeholder={report.columnMapping.localidad === undefined ? "Columna no disponible" : "Ej. Madrid"} className="mt-1.5 block min-h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-slate-100" /></label>
          <label className="text-xs font-semibold text-slate-600">Código Postal<input type="text" value={filters.codigo_postal ?? ""} onChange={(event) => updateGeographicFilter("codigo_postal", event.target.value)} disabled={report.columnMapping.codigo_postal === undefined} placeholder={report.columnMapping.codigo_postal === undefined ? "Columna no disponible" : "Ej. 28001"} className="mt-1.5 block min-h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-slate-100" /></label>
        </div>

        <div className="mt-4 border-t border-slate-100 pt-4">
          <p className="text-xs font-semibold text-slate-700">Operador actual</p>
          {report.currentOperatorOptions.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-2">
              {report.currentOperatorOptions.map((operator) => {
                const checked = filters.currentOperatorValues?.includes(operator.value) ?? false;
                return <label key={operator.value} className={`cursor-pointer rounded-lg border px-3 py-2 text-sm font-medium transition-colors focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-blue-600 ${checked ? "border-violet-600 bg-violet-50 text-violet-800" : "border-slate-200 text-slate-700 hover:border-violet-300"}`}><input type="checkbox" checked={checked} onChange={() => toggleCurrentOperator(operator.value)} className="sr-only" />{operator.label}</label>;
              })}
            </div>
          ) : <p className="mt-2 text-sm text-slate-500">No hay operadores actuales disponibles para filtrar.</p>}
        </div>

        <div className="mt-4 grid gap-3 border-t border-slate-100 pt-4 md:grid-cols-[minmax(220px,0.5fr)_minmax(260px,1fr)] md:items-end">
          <label className="text-xs font-semibold text-slate-600">Antigüedad mínima desde Fecha Portabilidad (meses)<input type="number" min="0" step="1" value={filters.minimumPortabilityMonths ?? ""} onChange={(event) => updateMinimumAge(event.target.value)} disabled={report.columnMapping.fecha_portabilidad === undefined} placeholder={report.columnMapping.fecha_portabilidad === undefined ? "Columna no disponible" : "Sin mínimo"} className="mt-1.5 block min-h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-slate-100" /></label>
          <label className="flex min-h-10 cursor-pointer items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm text-slate-700 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-blue-600"><input type="checkbox" checked={filters.includeWithoutPortabilityDate !== false} onChange={(event) => onFiltersChange({ ...filters, includeWithoutPortabilityDate: event.target.checked })} className="h-4 w-4 accent-blue-600" /><span><span className="font-semibold">Incluir registros sin fecha válida</span><span className="block text-xs text-slate-500">Puedes excluirlos explícitamente de la segmentación.</span></span></label>
        </div>
        <button type="button" onClick={clearFilters} className="mt-4 text-xs font-bold text-blue-700 hover:text-blue-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600">Limpiar filtros</button>
      </fieldset>

      <section aria-label="Resumen de filtros" className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
        <div className="flex flex-wrap items-center justify-between gap-2"><p><span className="font-semibold">{report.filteredRecords.length}</span> de {report.filterSummary.totalRecords} registros pasan los filtros.</p><p className="font-semibold text-slate-900">{report.filterSummary.excludedRecords.length} excluidos por filtros</p></div>
        {activeFilterReasons.length > 0 ? <p className="mt-2 text-xs text-slate-500">Desglose: {activeFilterReasons.map(([reason, count]) => `${campaignFilterReasonLabels[reason as keyof typeof campaignFilterReasonLabels]} (${count})`).join(" · ")}</p> : null}
      </section>

      {report.campaigns.length > 0 ? (
        <>
          <section aria-label="Resumen por campaña" className="grid gap-3 sm:grid-cols-2">
            {report.campaigns.map((campaign) => <CampaignSummaryCard key={campaign.operator.id} campaign={campaign} filteredOut={report.filterSummary.excludedRecords.length} selected={campaign.operator.id === activeCampaign?.operator.id} onSelect={() => setActiveCampaignId(campaign.operator.id)} />)}
          </section>

          {activeCampaign ? (
            <section aria-label={`Detalle de campaña ${activeCampaign.operator.label}`} className="min-w-0 rounded-xl border border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)] sm:p-6">
              <div className="flex flex-col gap-3 border-b border-slate-100 pb-4 sm:flex-row sm:items-start sm:justify-between">
                <div><p className="text-base font-semibold text-slate-900">Campaña {activeCampaign.operator.label}</p><p className="mt-1 text-sm text-slate-600">Los excluidos por tener el mismo operador se muestran aparte de los descartados por filtros. La fecha de portabilidad no indica permanencia contractual.</p></div>
                <div className="flex flex-wrap gap-2"><span className="w-fit rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-800">{activeCampaign.eligible.length} elegibles</span><span className="w-fit rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-700">Permanencia por registro</span></div>
              </div>

              <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3"><div className="rounded-lg bg-rose-50 px-3 py-2"><dt className="text-xs font-semibold text-rose-700">Excluidos por operador</dt><dd className="mt-1 font-semibold text-rose-900">{activeCampaign.excludedByOperator.length}</dd></div><div className="rounded-lg bg-amber-50 px-3 py-2"><dt className="text-xs font-semibold text-amber-700">Sin clasificar</dt><dd className="mt-1 font-semibold text-amber-900">{activeCampaign.unclassified.length}</dd></div><div className="rounded-lg bg-slate-50 px-3 py-2"><dt className="text-xs font-semibold text-slate-600">Excluidos por filtros</dt><dd className="mt-1 font-semibold text-slate-900">{report.filterSummary.excludedRecords.length}</dd></div></dl>

              <div className="mt-5"><DataTable caption={`Vista previa de elegibles para la campaña ${activeCampaign.operator.label}`} columns={detailColumns} rows={activeCampaign.eligible.map((record) => {
                const cells = [...record.cells];
                if (report.columnMapping.permanencia === undefined) {
                  cells.push(permanenceStatus(record, report.columnMapping));
                } else {
                  cells[report.columnMapping.permanencia] = permanenceStatus(record, report.columnMapping);
                }
                return { id: `campaign-${activeCampaign.operator.id}-${record.sourceRow}`, cells };
              })} emptyMessage="No hay registros elegibles para esta campaña con los filtros actuales." /></div>
            </section>
          ) : null}
        </>
      ) : <p className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-8 text-center text-sm text-slate-600">Selecciona al menos una campaña comercial para calcular la segmentación.</p>}
    </section>
  );
}
