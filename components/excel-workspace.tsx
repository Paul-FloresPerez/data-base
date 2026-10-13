"use client";

import type { ButtonHTMLAttributes, ChangeEvent, ReactNode } from "react";
import { useMemo, useRef, useState, useTransition } from "react";

import { AppShell, type WorkflowStep, type WorkspaceModule } from "@/components/app-shell";
import { CampaignEngine } from "@/components/campaign-engine";
import { DashboardOverview } from "@/components/dashboard-overview";
import { DataTable } from "@/components/data-table";
import { ExportWorkspace } from "@/components/export-workspace";
import { StatusCard } from "@/components/status-card";
import { buildCampaignReport, campaignOperators, type CampaignFilters } from "@/lib/campaigns/campaign-engine";
import { cleanDataset } from "@/lib/excel/cleaning";
import { buildEnrichmentOutput } from "@/lib/excel/enrichment-output";
import { importExcelFile } from "@/lib/excel/import-excel";
import {
  enrichedFieldHeaders,
  enrichedFieldOrder,
  exclusionReasonLabels,
  type CleaningResult,
  type EnrichmentMode,
  type EnrichmentOutput,
  type ExclusionReason,
  type ImportedDataset,
} from "@/lib/excel/types";
import { simulateHlrMnp } from "@/lib/services/mock-hlr";

function countLabel(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function ModuleHeading({
  eyebrow,
  title,
  description,
  action,
  headingId,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: ReactNode;
  headingId?: string;
}) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-blue-700">{eyebrow}</p>
        <h2 id={headingId} className="mt-1 text-2xl font-semibold tracking-tight text-[#10234a] sm:text-3xl">{title}</h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">{description}</p>
      </div>
      {action}
    </div>
  );
}

function EmptyModuleState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-dashed border-slate-300 bg-white px-5 py-12 text-center shadow-[0_1px_2px_rgba(15,23,42,0.03)] sm:px-8">
      <p className="text-sm font-semibold text-slate-900">{title}</p>
      <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-slate-600">{description}</p>
      <div className="mt-5">{action}</div>
    </section>
  );
}

function PrimaryButton({ children, className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={`inline-flex min-h-10 items-center justify-center rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-blue-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:cursor-not-allowed disabled:bg-slate-300 ${className}`}
    >
      {children}
    </button>
  );
}

function SecondaryButton({ children, className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={`inline-flex min-h-10 items-center justify-center rounded-lg border border-blue-200 bg-blue-50 px-4 text-sm font-semibold text-blue-800 transition-colors hover:bg-blue-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:cursor-not-allowed disabled:opacity-60 ${className}`}
    >
      {children}
    </button>
  );
}

export function ExcelWorkspace() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [activeModule, setActiveModule] = useState<WorkspaceModule>("dashboard");
  const [dataset, setDataset] = useState<ImportedDataset | null>(null);
  const [cleaning, setCleaning] = useState<CleaningResult | null>(null);
  const [enrichmentOutput, setEnrichmentOutput] = useState<EnrichmentOutput | null>(null);
  const [campaignFilters, setCampaignFilters] = useState<CampaignFilters>({ includeWithoutPortabilityDate: true });
  const [enrichmentMode, setEnrichmentMode] = useState<EnrichmentMode>("preserve");
  const [isOverwriteConfirmationOpen, setIsOverwriteConfirmationOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [isSimulating, setIsSimulating] = useState(false);
  const [isCleaning, startCleaning] = useTransition();

  const existingEnrichmentFields = dataset
    ? enrichedFieldOrder.filter((field) => dataset.columnMapping.enriched[field] !== undefined)
    : [];
  const hasExistingEnrichment = existingEnrichmentFields.length > 0;
  const visibleReasons = cleaning
    ? (Object.entries(cleaning.reasonBreakdown).filter(([, count]) => count > 0) as [ExclusionReason, number][])
    : [];

  const workflow = useMemo<WorkflowStep[]>(() => {
    const cleaningReady = Boolean(cleaning);
    const enrichmentReady = Boolean(enrichmentOutput);

    return [
      { id: "importar", label: "Importar", state: dataset ? "complete" : "current" },
      {
        id: "limpiar",
        label: "Limpiar",
        state: cleaningReady ? "complete" : dataset && activeModule === "limpieza" ? "current" : "pending",
      },
      {
        id: "enriquecer",
        label: "Enriquecer",
        state: enrichmentReady ? "complete" : cleaningReady && activeModule === "enriquecimiento" ? "current" : "pending",
      },
      {
        id: "segmentar",
        label: "Segmentar",
        state: enrichmentReady && activeModule === "campanas" ? "current" : "pending",
      },
      {
        id: "exportar",
        label: "Exportar",
        state: enrichmentReady && activeModule === "exportacion" ? "current" : "pending",
      },
    ];
  }, [activeModule, cleaning, dataset, enrichmentOutput]);
  const campaignReport = useMemo(
    () => enrichmentOutput ? buildCampaignReport(enrichmentOutput, campaignOperators, campaignFilters) : null,
    [campaignFilters, enrichmentOutput],
  );

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) {
      return;
    }

    setError(null);
    setIsImporting(true);

    try {
      const nextDataset = await importExcelFile(file);
      setDataset(nextDataset);
      setCleaning(null);
      setEnrichmentOutput(null);
      setCampaignFilters({ includeWithoutPortabilityDate: true });
      setEnrichmentMode("preserve");
      setIsOverwriteConfirmationOpen(false);
    } catch (caughtError) {
      setDataset(null);
      setCleaning(null);
      setEnrichmentOutput(null);
      setCampaignFilters({ includeWithoutPortabilityDate: true });
      setIsOverwriteConfirmationOpen(false);
      setError(caughtError instanceof Error ? caughtError.message : "No se pudo importar el archivo.");
    } finally {
      setIsImporting(false);
    }
  }

  function handleClean() {
    if (!dataset) {
      return;
    }

    if (dataset.columnMapping.nombre === undefined) {
      setError("No se puede continuar con la limpieza: falta la columna “Nombres” o “Nombre” en el Excel.");
      return;
    }

    setError(null);
    startCleaning(() => {
      setCleaning(cleanDataset(dataset));
      setEnrichmentOutput(null);
      setIsOverwriteConfirmationOpen(false);
    });
  }

  async function runSimulation() {
    if (!cleaning || !dataset || cleaning.validRecords.length === 0) {
      return;
    }

    setError(null);
    setIsSimulating(true);

    try {
      await new Promise<void>((resolve) => window.setTimeout(resolve, 350));
      const simulatedRecords = simulateHlrMnp(cleaning.validRecords);
      setEnrichmentOutput(buildEnrichmentOutput(dataset, simulatedRecords, enrichmentMode));
    } catch {
      setError("No se pudo completar la simulación local.");
    } finally {
      setIsSimulating(false);
    }
  }

  function handleSimulateEnrichment() {
    if (!cleaning || cleaning.validRecords.length === 0) {
      return;
    }

    if (hasExistingEnrichment && enrichmentMode === "overwrite") {
      setIsOverwriteConfirmationOpen(true);
      return;
    }

    void runSimulation();
  }

  function handleModeChange(mode: EnrichmentMode) {
    setEnrichmentMode(mode);
    setEnrichmentOutput(null);
  }

  function navigate(module: WorkspaceModule) {
    setActiveModule(module);
  }

  function renderImportModule() {
    return (
      <section aria-labelledby="importacion-title" className="space-y-5">
        <ModuleHeading
          eyebrow="Importación local"
          headingId="importacion-title"
          title="Importa tu base de contactos"
          description="Lee archivos Excel en este navegador. La estructura y el orden de la base se conservan para los módulos posteriores."
        />

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(300px,0.8fr)]">
          <section className="rounded-xl border border-dashed border-blue-300 bg-white p-6 shadow-[0_1px_2px_rgba(15,23,42,0.03)] sm:p-8">
            <div className="mx-auto max-w-md text-center">
              <p className="text-base font-semibold text-slate-900">Selecciona un archivo Excel</p>
              <p className="mt-2 text-sm leading-6 text-slate-600">Se procesará localmente. El archivo original no se modifica ni se envía a un servidor.</p>
              <input
                ref={fileInputRef}
                className="sr-only"
                type="file"
                accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                onChange={handleFileChange}
              />
              <PrimaryButton type="button" disabled={isImporting} onClick={() => fileInputRef.current?.click()} className="mt-5">
                {isImporting ? "Leyendo Excel…" : "Subir Excel"}
              </PrimaryButton>
              <p className="mt-4 text-xs leading-5 text-slate-500">Formato admitido: .xlsx · Los encabezados se detectan de manera flexible.</p>
              <p aria-live="polite" className="sr-only">{isImporting ? "Importando archivo Excel" : ""}</p>
            </div>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
            <p className="text-sm font-semibold text-slate-900">Resumen de importación</p>
            {dataset ? (
              <dl className="mt-4 divide-y divide-slate-100 text-sm">
                <div className="flex items-center justify-between gap-4 py-3"><dt className="text-slate-600">Archivo</dt><dd className="max-w-48 truncate font-medium text-slate-900" title={dataset.fileName}>{dataset.fileName}</dd></div>
                <div className="flex items-center justify-between gap-4 py-3"><dt className="text-slate-600">Registros leídos</dt><dd className="font-semibold text-slate-900">{dataset.records.length}</dd></div>
                <div className="flex items-center justify-between gap-4 py-3"><dt className="text-slate-600">Columnas</dt><dd className="font-semibold text-slate-900">{dataset.columns.length}</dd></div>
              </dl>
            ) : <p className="mt-3 text-sm leading-6 text-slate-600">Aún no has seleccionado un archivo. La vista previa aparecerá aquí después de una importación correcta.</p>}
          </section>
        </div>

        {dataset ? (
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)] sm:p-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div><p className="text-sm font-semibold text-slate-900">Vista previa de registros</p><p className="mt-1 text-sm text-slate-600">El detalle queda disponible solo dentro de los módulos operativos.</p></div>
              <SecondaryButton type="button" onClick={() => navigate("limpieza")}>Ir a limpieza</SecondaryButton>
            </div>
            {dataset.columnMapping.nombre === undefined ? <p role="status" className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">Falta la columna “Nombres” o “Nombre”. La importación se conserva, pero no se podrá ejecutar la limpieza.</p> : null}
            <div className="mt-5">
              <DataTable caption="Vista previa de registros importados" columns={["Fila", ...dataset.columns]} rows={dataset.records.map((record) => ({ id: `preview-${record.sourceRow}`, cells: [String(record.sourceRow), ...record.cells] }))} emptyMessage="El archivo no contiene registros debajo de los encabezados." />
            </div>
          </section>
        ) : null}
      </section>
    );
  }

  function renderCleaningModule() {
    if (!dataset) {
      return <EmptyModuleState title="Primero importa una base" description="La limpieza necesita una base Excel cargada para validar móviles, nombres y duplicados sin alterar el archivo original." action={<PrimaryButton type="button" onClick={() => navigate("importacion")}>Ir a importación</PrimaryButton>} />;
    }

    return (
      <section aria-labelledby="limpieza-title" className="space-y-5">
        <ModuleHeading
          eyebrow="Validación de base"
          headingId="limpieza-title"
          title="Limpieza de registros"
          description="Solo los móviles españoles válidos avanzan al enriquecimiento. Los excluidos se conservan localmente con su motivo y fila de origen."
          action={<SecondaryButton type="button" disabled={dataset.columnMapping.nombre === undefined || isCleaning} onClick={handleClean}>{isCleaning ? "Limpiando…" : "Limpiar base"}</SecondaryButton>}
        />

        {dataset.columnMapping.nombre === undefined ? <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">No se puede continuar: falta la columna “Nombres” o “Nombre” en el Excel.</div> : null}

        {cleaning ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              <StatusCard label="Importados" value={dataset.records.length} tone="blue" hint="Registros conservados" />
              <StatusCard label="Válidos" value={cleaning.validRecords.length} tone="emerald" hint="Listos para enriquecer" />
              <StatusCard label="Excluidos" value={cleaning.excludedRecords.length} tone="rose" hint="Retenidos en memoria" />
            </div>
            <div className="grid gap-5 xl:grid-cols-[minmax(270px,0.65fr)_minmax(0,1.35fr)]">
              <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
                <p className="text-sm font-semibold text-slate-900">Motivos de exclusión</p>
                <dl className="mt-4 divide-y divide-slate-100">
                  {visibleReasons.length > 0 ? visibleReasons.map(([reason, count]) => <div key={reason} className="flex items-center justify-between gap-4 py-3 text-sm"><dt className="text-slate-600">{exclusionReasonLabels[reason]}</dt><dd className="font-semibold text-slate-900">{count}</dd></div>) : <div className="py-4 text-sm text-emerald-700">No se excluyeron registros.</div>}
                </dl>
                <SecondaryButton type="button" onClick={() => navigate("enriquecimiento")} className="mt-5">Continuar a enriquecimiento</SecondaryButton>
              </section>
              <section className="min-w-0 rounded-xl border border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
                <p className="text-sm font-semibold text-slate-900">Registros excluidos</p>
                <p className="mt-1 text-sm text-slate-600">Estos registros no se envían a la simulación.</p>
                <div className="mt-4"><DataTable caption="Registros excluidos durante la limpieza" columns={["Fila", "Móvil original", "Nombre", "Motivo"]} rows={cleaning.excludedRecords.map((record) => ({ id: `excluded-${record.sourceRow}`, cells: [String(record.sourceRow), record.mobile, record.name, exclusionReasonLabels[record.reason]] }))} emptyMessage="No hay registros excluidos." /></div>
              </section>
            </div>
          </>
        ) : <EmptyModuleState title="Base lista para validar" description="Ejecuta la limpieza para detectar teléfonos no válidos, nombres vacíos o NULL y números duplicados." action={<PrimaryButton type="button" disabled={dataset.columnMapping.nombre === undefined || isCleaning} onClick={handleClean}>{isCleaning ? "Limpiando…" : "Limpiar base"}</PrimaryButton>} />}
      </section>
    );
  }

  function renderEnrichmentModule() {
    if (!cleaning) {
      return <EmptyModuleState title="La limpieza es necesaria antes de enriquecer" description="Primero valida la base para que solo los registros aptos pasen a la simulación local de HLR/MNP." action={<PrimaryButton type="button" onClick={() => navigate("limpieza")}>Ir a limpieza</PrimaryButton>} />;
    }

    return (
      <section aria-labelledby="enriquecimiento-title" className="space-y-5">
        <ModuleHeading eyebrow="Simulación local" headingId="enriquecimiento-title" title="Enriquecimiento HLR/MNP" description="Los resultados del mock son deterministas y se muestran siempre como simulados; no se hacen llamadas externas." />
        <div className="grid gap-5 xl:grid-cols-[minmax(290px,0.7fr)_minmax(0,1.3fr)]">
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
            <p className="text-sm font-semibold text-slate-900">Configuración</p>
            <p className="mt-1 text-sm leading-6 text-slate-600">{countLabel(cleaning.validRecords.length, "registro válido", "registros válidos")} pueden pasar a la simulación.</p>
            {hasExistingEnrichment ? (
              <fieldset className="mt-5 rounded-lg border border-slate-200 p-4">
                <legend className="px-1 text-sm font-semibold text-slate-800">Campos enriquecidos existentes</legend>
                <p className="mt-1 text-xs leading-5 text-slate-500">Detectados: {existingEnrichmentFields.map((field) => enrichedFieldHeaders[field]).join(", ")}.</p>
                <label className="mt-3 flex cursor-pointer items-start gap-3 text-sm text-slate-700"><input type="radio" name="enrichment-mode" checked={enrichmentMode === "preserve"} onChange={() => handleModeChange("preserve")} className="mt-0.5 accent-blue-600" /><span><span className="font-medium">Conservar datos existentes</span><span className="mt-0.5 block text-xs text-slate-500">Mantiene los valores de las columnas detectadas.</span></span></label>
                <label className="mt-3 flex cursor-pointer items-start gap-3 text-sm text-slate-700"><input type="radio" name="enrichment-mode" checked={enrichmentMode === "overwrite"} onChange={() => handleModeChange("overwrite")} className="mt-0.5 accent-blue-600" /><span><span className="font-medium">Sobrescribir con el mock</span><span className="mt-0.5 block text-xs text-slate-500">Solicita confirmación antes de reemplazar valores.</span></span></label>
              </fieldset>
            ) : <p className="mt-5 rounded-lg bg-slate-50 px-4 py-3 text-xs leading-5 text-slate-600">No se detectaron campos enriquecidos. La simulación añadirá los siete campos al resultado, sin modificar el Excel original.</p>}
            <PrimaryButton type="button" disabled={cleaning.validRecords.length === 0 || isSimulating} onClick={handleSimulateEnrichment} className="mt-5 w-full">{isSimulating ? "Simulando enriquecimiento…" : "Simular enriquecimiento"}</PrimaryButton>
            <p aria-live="polite" className="mt-3 text-xs leading-5 text-slate-500">{isSimulating ? "Procesando únicamente los registros válidos…" : "Operador y portabilidad simulados; no son datos reales."}</p>
            {isOverwriteConfirmationOpen ? (
              <div role="alertdialog" aria-modal="true" aria-labelledby="overwrite-title" className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-4">
                <p id="overwrite-title" className="text-sm font-semibold text-amber-950">¿Sobrescribir campos enriquecidos?</p>
                <p className="mt-1 text-xs leading-5 text-amber-900">Se reemplazarán únicamente los campos enriquecidos detectados con valores simulados. Las columnas originales y los demás datos no cambiarán.</p>
                <div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={() => setIsOverwriteConfirmationOpen(false)} className="rounded-lg border border-amber-300 bg-white px-3 py-2 text-xs font-semibold text-amber-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-600">Cancelar</button><button type="button" onClick={() => { setIsOverwriteConfirmationOpen(false); void runSimulation(); }} className="rounded-lg bg-amber-700 px-3 py-2 text-xs font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700">Confirmar y simular</button></div>
              </div>
            ) : null}
          </section>

          <section className="min-w-0 rounded-xl border border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div><p className="text-sm font-semibold text-slate-900">Resultados de enriquecimiento</p><p className="mt-1 text-sm text-slate-600">La salida conserva las columnas originales y su orden.</p></div>
              <span className="w-fit rounded-full bg-amber-100 px-3 py-1 text-xs font-bold tracking-wide text-amber-900">SIMULADO · NO SON DATOS REALES</span>
            </div>
            {enrichmentOutput ? <div className="mt-5"><DataTable caption="Resultados simulados de HLR y MNP" columns={enrichmentOutput.columns} rows={enrichmentOutput.rows.map((record) => ({ id: `enriched-${record.sourceRow}`, cells: record.cells }))} emptyMessage="Todavía no hay resultados simulados." /></div> : <div className="mt-5 rounded-lg border border-dashed border-slate-300 px-4 py-10 text-center text-sm text-slate-600">Cuando ejecutes la simulación, los resultados aparecerán aquí.</div>}
          </section>
        </div>
      </section>
    );
  }

  function renderCampaignsModule() {
    if (!enrichmentOutput) {
      return <EmptyModuleState title="Aún no hay datos para segmentar" description="Completa la limpieza y el enriquecimiento simulado para consultar la elegibilidad por operador y los filtros geográficos." action={<PrimaryButton type="button" onClick={() => navigate("enriquecimiento")}>Ir a enriquecimiento</PrimaryButton>} />;
    }

    return <CampaignEngine output={enrichmentOutput} filters={campaignFilters} onFiltersChange={setCampaignFilters} />;
  }

  function renderExportModule() {
    if (!enrichmentOutput || !campaignReport) {
      return <EmptyModuleState title="Completa el enriquecimiento antes de exportar" description="La exportación requiere una base válida y enriquecida. Los lotes de campañas respetarán los filtros activos cuando haya resultados disponibles." action={<PrimaryButton type="button" onClick={() => navigate("enriquecimiento")}>Ir a enriquecimiento</PrimaryButton>} />;
    }

    return <ExportWorkspace output={enrichmentOutput} report={campaignReport} />;
  }

  let moduleContent: ReactNode;
  if (activeModule === "dashboard") {
    moduleContent = <DashboardOverview imported={dataset?.records.length ?? 0} valid={cleaning?.validRecords.length ?? null} excluded={cleaning?.excludedRecords.length ?? null} enriched={enrichmentOutput?.rows.length ?? null} campaigns={enrichmentOutput ? 4 : 0} onNavigate={navigate} />;
  } else if (activeModule === "importacion") {
    moduleContent = renderImportModule();
  } else if (activeModule === "limpieza") {
    moduleContent = renderCleaningModule();
  } else if (activeModule === "enriquecimiento") {
    moduleContent = renderEnrichmentModule();
  } else if (activeModule === "campanas") {
    moduleContent = renderCampaignsModule();
  } else {
    moduleContent = renderExportModule();
  }

  return (
    <AppShell activeModule={activeModule} onNavigate={navigate} workflow={workflow}>
      {error ? <div role="alert" className="mb-5 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900"><span className="font-semibold">No se pudo continuar: </span>{error}</div> : null}
      {moduleContent}
    </AppShell>
  );
}
