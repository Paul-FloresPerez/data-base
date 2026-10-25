"use client";

import type { ButtonHTMLAttributes, ChangeEvent, ReactNode } from "react";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";

import { AppShell, type WorkflowStep, type WorkspaceModule } from "@/components/app-shell";
import { CampaignEngine } from "@/components/campaign-engine";
import { DashboardOverview } from "@/components/dashboard-overview";
import { DataTable } from "@/components/data-table";
import { DistributionWorkspace } from "@/components/distribution-workspace";
import { ExportWorkspace } from "@/components/export-workspace";
import { SavedBasesPanel } from "@/components/saved-bases-panel";
import { RecyclingWorkspaceV2 } from "@/components/recycling-workspace-v2";
import { StatusCard } from "@/components/status-card";
import { buildCampaignReport, campaignOperators, type CampaignFilters, type CampaignOperatorId } from "@/lib/campaigns/campaign-engine";
import { cleanDataset } from "@/lib/excel/cleaning";
import { buildEnrichmentOutput } from "@/lib/excel/enrichment-output";
import { importExcelFile } from "@/lib/excel/import-excel";
import {
  enrichedFieldHeaders,
  enrichedFieldOrder,
  exclusionReasonLabels,
  type CleaningResult,
  type EnrichedRecord,
  type EnrichmentMode,
  type EnrichmentOutput,
  type ExclusionReason,
  type ImportedDataset,
} from "@/lib/excel/types";
import { simulateHlrMnp } from "@/lib/services/mock-hlr";
import { getPendingRealHlrRecords, getRealHlrPreview } from "@/lib/services/real-hlr-preview";
import { prepareDisabledRealHlrQueue } from "@/lib/services/real-hlr-queue-plan";
import { saveBatchToHistory } from "@/lib/persistence/client-base-save";
import { buildMasterOutput } from "@/lib/export/xlsx-export";
import {
  createWorkingBatch,
  defaultCampaignFilters,
  defaultDistributionSettings,
  getProcessingModule,
  summarizeBatch,
  type DistributionSettings,
  type WorkingBatch,
} from "@/lib/workspace/batch";

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
    <div className="flex flex-col gap-4 border-b border-slate-200 pb-5 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#174ea6]">{eyebrow}</p>
        <h2 id={headingId} className="mt-1 text-2xl font-semibold tracking-tight text-[#0f274f] sm:text-3xl">{title}</h2>
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
    <section className="border border-dashed border-slate-300 bg-white px-5 py-12 text-center sm:px-8">
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
      className={`inline-flex min-h-10 items-center justify-center rounded-md bg-[#174ea6] px-4 text-sm font-semibold text-white transition-colors hover:bg-[#123f87] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#174ea6] disabled:cursor-not-allowed disabled:bg-slate-300 ${className}`}
    >
      {children}
    </button>
  );
}

function SecondaryButton({ children, className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={`inline-flex min-h-10 items-center justify-center rounded-md border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#174ea6] disabled:cursor-not-allowed disabled:opacity-60 ${className}`}
    >
      {children}
    </button>
  );
}

export function ExcelWorkspace() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [activeModule, setActiveModule] = useState<WorkspaceModule>("dashboard");
  const [batch, setBatch] = useState<WorkingBatch | null>(null);
  const [isDemoMode, setIsDemoMode] = useState(false);
  const [isOverwriteConfirmationOpen, setIsOverwriteConfirmationOpen] = useState(false);
  const [isNewBatchConfirmationOpen, setIsNewBatchConfirmationOpen] = useState(false);
  const [isReplaceConfirmationOpen, setIsReplaceConfirmationOpen] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [isSimulating, setIsSimulating] = useState(false);
  const [realHlrLimit, setRealHlrLimit] = useState("100");
  const [realHlrBudget, setRealHlrBudget] = useState("0");
  const [isRealHlrQueueConfirmed, setIsRealHlrQueueConfirmed] = useState(false);
  const [isCleaning, startCleaning] = useTransition();
  const [saveState, setSaveState] = useState<"error" | "saved" | "saving" | "unsaved">("saved");
  const [saveRetry, setSaveRetry] = useState(0);
  const currentBatchRef = useRef<WorkingBatch | null>(null);
  const saveInFlightRef = useRef(false);
  const lastSavedSignatureRef = useRef<string | null>(null);
  const dataset: ImportedDataset | null = batch?.dataset ?? null;
  const cleaning: CleaningResult | null = batch?.cleaning ?? null;
  const enrichmentOutput: EnrichmentOutput | null = batch?.enrichmentOutput ?? null;
  const campaignFilters: CampaignFilters = batch?.campaignFilters ?? defaultCampaignFilters;
  const batchSignature = useMemo(() => batch ? JSON.stringify(batch) : null, [batch]);

  useEffect(() => {
    currentBatchRef.current = batch;
  }, [batch]);

  useEffect(() => {
    if (!batch || !batchSignature) {
      return;
    }
    if (lastSavedSignatureRef.current === batchSignature) {
      return;
    }

    const unsavedTimer = window.setTimeout(() => setSaveState("unsaved"), 0);
    const timer = window.setTimeout(() => {
      if (saveInFlightRef.current) return;
      const savingBatch = currentBatchRef.current;
      if (!savingBatch) return;
      const savingSignature = JSON.stringify(savingBatch);
      saveInFlightRef.current = true;
      setSaveState("saving");
      let completed = false;
      void saveBatchToHistory(savingBatch, savingBatch.displayName ?? savingBatch.fileName.replace(/\.xlsx$/i, ""))
        .then(() => {
          completed = true;
          lastSavedSignatureRef.current = savingSignature;
          setSaveState("saved");
        })
        .catch(() => setSaveState("error"))
        .finally(() => {
          saveInFlightRef.current = false;
          if (completed && currentBatchRef.current && JSON.stringify(currentBatchRef.current) !== savingSignature) {
            setSaveRetry((current) => current + 1);
          }
        });
    }, 1_500);
    return () => {
      window.clearTimeout(unsavedTimer);
      window.clearTimeout(timer);
    };
  }, [batch, batchSignature, saveRetry]);

  const existingEnrichmentFields = dataset
    ? enrichedFieldOrder.filter((field) => dataset.columnMapping.enriched[field] !== undefined)
    : [];
  const hasExistingEnrichment = existingEnrichmentFields.length > 0;
  const visibleReasons = cleaning
    ? (Object.entries(cleaning.reasonBreakdown).filter(([, count]) => count > 0) as [ExclusionReason, number][])
    : [];
  const realHlrPreview = useMemo(
    () => cleaning && dataset ? getRealHlrPreview(cleaning, dataset, batch?.provenanceBySourceRow ?? {}) : null,
    [batch?.provenanceBySourceRow, cleaning, dataset],
  );

  const workflow = useMemo<WorkflowStep[]>(() => {
    const cleaningReady = Boolean(cleaning);
    const enrichmentReady = Boolean(enrichmentOutput);

    return [
      { id: "importar", label: "Importar", module: "importacion", state: dataset ? "complete" : activeModule === "importacion" ? "current" : "pending" },
      {
        id: "limpiar",
        label: "Limpiar",
        module: "limpieza",
        state: cleaningReady ? "complete" : dataset && activeModule === "limpieza" ? "current" : "pending",
      },
      {
        id: "enriquecer",
        label: "Enriquecer",
        module: "enriquecimiento",
        state: enrichmentReady ? "complete" : cleaningReady && activeModule === "enriquecimiento" ? "current" : "pending",
      },
      {
        id: "segmentar",
        label: "Segmentar",
        module: "campanas",
        state: enrichmentReady && activeModule === "campanas" ? "current" : enrichmentReady && ["distribucion", "exportacion"].includes(activeModule) ? "complete" : "pending",
      },
      {
        id: "distribuir",
        label: "Distribuir",
        module: "distribucion",
        state: enrichmentReady && activeModule === "distribucion" ? "current" : enrichmentReady && activeModule === "exportacion" ? "complete" : "pending",
      },
      {
        id: "exportar",
        label: "Exportar",
        module: "exportacion",
        state: batch?.exportCompletedAt ? "complete" : enrichmentReady && activeModule === "exportacion" ? "current" : "pending",
      },
    ];
  }, [activeModule, batch?.exportCompletedAt, cleaning, dataset, enrichmentOutput]);
  const campaignReport = useMemo(
    () => enrichmentOutput ? buildCampaignReport(enrichmentOutput, campaignOperators, campaignFilters) : null,
    [campaignFilters, enrichmentOutput],
  );
  const masterOutput = useMemo(
    () => dataset ? buildMasterOutput(dataset, enrichmentOutput) : null,
    [dataset, enrichmentOutput],
  );

  async function importFile(file: File) {
    setError(null);
    setIsImporting(true);

    try {
      const nextDataset = await importExcelFile(file);
      setBatch(createWorkingBatch(nextDataset));
      setIsDemoMode(false);
      setIsOverwriteConfirmationOpen(false);
      setIsReplaceConfirmationOpen(false);
      setPendingFile(null);
      setActiveModule("importacion");
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "No se pudo importar el archivo.");
    } finally {
      setIsImporting(false);
    }
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) {
      return;
    }

    if (batch) {
      setPendingFile(file);
      setIsReplaceConfirmationOpen(true);
      return;
    }

    void importFile(file);
  }

  function startNewBatch() {
    if (batch) {
      setIsNewBatchConfirmationOpen(true);
      return;
    }

    setActiveModule("importacion");
  }

  function confirmNewBatch() {
    setBatch(null);
    setPendingFile(null);
    setError(null);
    setIsDemoMode(false);
    setIsOverwriteConfirmationOpen(false);
    setIsNewBatchConfirmationOpen(false);
    setIsReplaceConfirmationOpen(false);
    setActiveModule("importacion");
  }

  function confirmReplaceBatch() {
    if (!pendingFile) {
      setIsReplaceConfirmationOpen(false);
      return;
    }

    void importFile(pendingFile);
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
      const nextCleaning = cleanDataset(dataset);
      setBatch((currentBatch) => currentBatch && currentBatch.id === batch?.id
        ? {
            ...currentBatch,
            cleaning: nextCleaning,
            enrichmentOutput: null,
            campaignFilters: { ...defaultCampaignFilters },
            distribution: defaultDistributionSettings(),
            exportCompletedAt: null,
            realHlrQueue: null,
          }
        : currentBatch);
      setIsOverwriteConfirmationOpen(false);
    });
  }

  async function runSimulation(mode: EnrichmentMode) {
    if (!cleaning || !dataset || cleaning.validRecords.length === 0) {
      return;
    }
    if (!isDemoMode) {
      setError("No hay API HLR real configurada. Activa el modo demostración para usar datos mock identificados como tales.");
      return;
    }

    setError(null);
    setIsSimulating(true);

    try {
      await new Promise<void>((resolve) => window.setTimeout(resolve, 350));
      const actualIndex = dataset.columnMapping.enriched.operador_actual;
      const originIndex = dataset.columnMapping.enriched.operador_origen;
      const pending = mode === "overwrite"
        ? cleaning.validRecords
        : cleaning.validRecords.filter((record) => !record.cells[actualIndex ?? -1]?.trim() || !record.cells[originIndex ?? -1]?.trim());
      const mocked = new Map(simulateHlrMnp(pending).map((record) => [record.sourceRow, record]));
      const enrichedRecords: EnrichedRecord[] = cleaning.validRecords.map((record) => {
        const existing = {
          operador_actual: actualIndex === undefined ? "" : record.cells[actualIndex] ?? "",
          operador_origen: originIndex === undefined ? "" : record.cells[originIndex] ?? "",
          fecha_portabilidad: dataset.columnMapping.enriched.fecha_portabilidad === undefined ? null : record.cells[dataset.columnMapping.enriched.fecha_portabilidad] || null,
        };
        return { ...record, ...existing, ...(mocked.get(record.sourceRow) ?? {}) };
      });
      const nextOutput = buildEnrichmentOutput(dataset, enrichedRecords, mode);
      setBatch((currentBatch) => currentBatch && currentBatch.id === batch?.id
        ? { ...currentBatch, enrichmentOutput: nextOutput, exportCompletedAt: null, realHlrQueue: null, provenanceBySourceRow: { ...currentBatch.provenanceBySourceRow, ...Object.fromEntries(pending.map((record) => [record.sourceRow, "MOCK"])) } }
        : currentBatch);
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

    void runSimulation("preserve");
  }

  function handleRefreshOperators() {
    if (!cleaning || cleaning.validRecords.length === 0) return;
    setIsOverwriteConfirmationOpen(true);
  }

  function prepareRealHlrQueue() {
    if (!batch || !cleaning || !dataset || !isRealHlrQueueConfirmed) return;
    const maxQueries = Number(realHlrLimit);
    const budgetLimit = Number(realHlrBudget);
    try {
      const records = getPendingRealHlrRecords(cleaning, dataset, batch.provenanceBySourceRow);
      const queue = prepareDisabledRealHlrQueue({ baseId: batch.id, records, maxQueries, budgetLimit });
      setBatch((current) => current?.id === batch.id ? { ...current, realHlrQueue: queue } : current);
      setError(null);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "No se pudo preparar la cola HLR.");
    }
  }

  function updateCampaignFilters(nextFilters: CampaignFilters) {
    setBatch((currentBatch) => currentBatch ? { ...currentBatch, exportCompletedAt: null, campaignFilters: nextFilters } : currentBatch);
  }

  function updateSelectedCampaigns(selectedCampaigns: CampaignOperatorId[]) {
    setBatch((currentBatch) => currentBatch
      ? { ...currentBatch, exportCompletedAt: null, distribution: { ...currentBatch.distribution, selectedCampaigns } }
      : currentBatch);
  }

  function updateDistribution(settings: DistributionSettings) {
    setBatch((currentBatch) => currentBatch ? { ...currentBatch, exportCompletedAt: null, distribution: settings } : currentBatch);
  }

  function navigate(module: WorkspaceModule) {
    setActiveModule(module);
  }

  function openProcessing() {
    const current = ["importacion", "limpieza", "enriquecimiento", "campanas", "distribucion", "exportacion"].includes(activeModule)
      ? activeModule as import("@/lib/workspace/batch").ProcessingModule
      : null;
    navigate(getProcessingModule(batch, current));
  }

  function renderImportModule() {
    return (
      <section aria-labelledby="importacion-title" className="space-y-5">
        <ModuleHeading
          eyebrow="Importación local"
          headingId="importacion-title"
          title="Importa tu base de contactos"
          description="Lee archivos Excel en este navegador. La estructura y el orden de la base se conservan para los módulos posteriores."
          action={<SecondaryButton type="button" onClick={() => navigate("dashboard")}>Volver al resumen</SecondaryButton>}
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
          action={<div className="flex flex-wrap gap-2"><SecondaryButton type="button" onClick={() => navigate("importacion")}>Volver a importación</SecondaryButton>{cleaning ? <PrimaryButton type="button" onClick={() => navigate("enriquecimiento")}>Continuar a enriquecimiento</PrimaryButton> : <SecondaryButton type="button" disabled={dataset.columnMapping.nombre === undefined || isCleaning} onClick={handleClean}>{isCleaning ? "Limpiando…" : "Limpiar base"}</SecondaryButton>}</div>}
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
        <ModuleHeading eyebrow="Enriquecimiento" headingId="enriquecimiento-title" title="Enriquecer base" description="Conserva los operadores ya informados y trata solo los registros pendientes. No hay una API HLR real configurada." action={<div className="flex flex-wrap gap-2"><SecondaryButton type="button" onClick={() => navigate("limpieza")}>Volver a limpieza</SecondaryButton>{enrichmentOutput ? <PrimaryButton type="button" onClick={() => navigate("campanas")}>Continuar a campañas</PrimaryButton> : null}</div>} />
        <div className="grid gap-5 xl:grid-cols-[minmax(290px,0.7fr)_minmax(0,1.3fr)]">
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
            <p className="text-sm font-semibold text-slate-900">Configuración</p>
            <p className="mt-1 text-sm leading-6 text-slate-600">{countLabel(cleaning.validRecords.length, "registro válido", "registros válidos")} disponibles. Los datos existentes se conservan.</p>
            {hasExistingEnrichment ? (
              <div className="mt-5 rounded-lg border border-slate-200 p-4">
                <p className="text-sm font-semibold text-slate-800">Campos enriquecidos existentes</p>
                <p className="mt-1 text-xs leading-5 text-slate-500">Detectados: {existingEnrichmentFields.map((field) => enrichedFieldHeaders[field]).join(", ")}.</p>
              </div>
            ) : <p className="mt-5 rounded-lg bg-slate-50 px-4 py-3 text-xs leading-5 text-slate-600">No se detectaron operadores. La salida mantendrá las columnas originales y añadirá solo los campos faltantes.</p>}
            {realHlrPreview ? <section className="mt-5 border border-slate-200 bg-slate-50 p-4" aria-labelledby="real-hlr-title"><div className="flex items-start justify-between gap-3"><div><p id="real-hlr-title" className="text-sm font-semibold text-slate-900">Preparación HLR real</p><p className="mt-1 text-xs leading-5 text-slate-600">Solo usa la columna móvil detectada. El proveedor está deshabilitado y esta fase no transmite números.</p></div><span className="border border-amber-200 bg-amber-50 px-2 py-1 text-[10px] font-bold tracking-wide text-amber-900">SIN RED</span></div><dl className="mt-4 grid grid-cols-2 gap-x-3 gap-y-3 text-xs"><div><dt className="text-slate-500">Móviles válidos</dt><dd className="mt-0.5 font-semibold text-slate-900">{realHlrPreview.validRecords}</dd></div><div><dt className="text-slate-500">Móviles únicos</dt><dd className="mt-0.5 font-semibold text-slate-900">{realHlrPreview.uniqueMobiles}</dd></div><div><dt className="text-slate-500">Fijos excluidos</dt><dd className="mt-0.5 font-semibold text-rose-800">{realHlrPreview.fixedExcluded}</dd></div><div><dt className="text-slate-500">Inválidos o vacíos</dt><dd className="mt-0.5 font-semibold text-rose-800">{realHlrPreview.invalidExcluded}</dd></div><div><dt className="text-slate-500">Duplicados excluidos</dt><dd className="mt-0.5 font-semibold text-rose-800">{realHlrPreview.duplicateExcluded}</dd></div><div><dt className="text-slate-500">Pendientes</dt><dd className="mt-0.5 font-semibold text-amber-900">{realHlrPreview.pendingQueries}</dd></div><div><dt className="text-slate-500">API real previa</dt><dd className="mt-0.5 font-semibold text-emerald-800">{realHlrPreview.enrichedByRealApi}</dd></div></dl>{realHlrPreview.enrichedFromExistingData > 0 ? <p className="mt-3 text-xs leading-5 text-slate-600">{realHlrPreview.enrichedFromExistingData} móviles contienen operadores de Excel o mock, sin evidencia de una consulta real; no se programan automáticamente.</p> : null}<div className="mt-4 grid gap-2 sm:grid-cols-2"><label className="text-xs font-semibold text-slate-700">Límite futuro de consultas<input type="number" min="1" max="10000" value={realHlrLimit} onChange={(event) => setRealHlrLimit(event.target.value)} className="mt-1 min-h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm font-normal" /></label><label className="text-xs font-semibold text-slate-700">Presupuesto máximo declarado<input type="number" min="0" step="0.01" value={realHlrBudget} onChange={(event) => setRealHlrBudget(event.target.value)} className="mt-1 min-h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm font-normal" /></label></div><label className="mt-3 flex items-start gap-2 text-xs leading-5 text-slate-700"><input type="checkbox" checked={isRealHlrQueueConfirmed} onChange={(event) => setIsRealHlrQueueConfirmed(event.target.checked)} className="mt-0.5" />Confirmo que solo quiero preparar una cola bloqueada; no autoriza consultas ni gasto.</label><SecondaryButton type="button" disabled={!isRealHlrQueueConfirmed || realHlrPreview.pendingQueries === 0} onClick={prepareRealHlrQueue} className="mt-3 w-full">Preparar cola bloqueada (sin consultas)</SecondaryButton>{batch?.realHlrQueue ? <p className="mt-3 border border-blue-200 bg-blue-50 px-3 py-2 text-xs leading-5 text-blue-900">Cola preparada: {batch.realHlrQueue.jobs.length} solicitudes máximas, estado bloqueado. Se conserva al guardar la base y no puede ejecutarse desde esta versión.</p> : null}<p className="mt-3 text-xs leading-5 text-slate-500">Faltan por documentar la autenticación, tarifas, límites, campos de respuesta y semántica de operadores/portabilidad del proveedor.</p></section> : null}
            <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950"><input type="checkbox" checked={isDemoMode} onChange={(event) => setIsDemoMode(event.target.checked)} className="mt-0.5 accent-amber-700" /><span><span className="font-semibold">Usar mock en modo demostración</span><span className="mt-0.5 block text-xs leading-5 text-amber-900">Genera datos simulados solo para registros pendientes; se guardarán con procedencia MOCK.</span></span></label>
            <PrimaryButton type="button" disabled={cleaning.validRecords.length === 0 || isSimulating} onClick={handleSimulateEnrichment} className="mt-5 w-full">{isSimulating ? "Enriqueciendo…" : "Enriquecer base"}</PrimaryButton>
            {hasExistingEnrichment ? <SecondaryButton type="button" disabled={cleaning.validRecords.length === 0 || isSimulating} onClick={handleRefreshOperators} className="mt-2 w-full">Actualizar operadores</SecondaryButton> : null}
            <p aria-live="polite" className="mt-3 text-xs leading-5 text-slate-500">{isSimulating ? "Procesando únicamente registros pendientes…" : "El mock no equivale a una consulta real de HLR/MNP."}</p>
            {isOverwriteConfirmationOpen ? (
              <div role="alertdialog" aria-modal="true" aria-labelledby="overwrite-title" className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-4">
                <p id="overwrite-title" className="text-sm font-semibold text-amber-950">¿Sobrescribir campos enriquecidos?</p>
                <p className="mt-1 text-xs leading-5 text-amber-900">Se reemplazarán los operadores con datos mock. Las columnas originales y el resto de los datos no cambiarán.</p>
                <div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={() => setIsOverwriteConfirmationOpen(false)} className="rounded-lg border border-amber-300 bg-white px-3 py-2 text-xs font-semibold text-amber-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-600">Cancelar</button><button type="button" onClick={() => { setIsOverwriteConfirmationOpen(false); void runSimulation("overwrite"); }} className="rounded-lg bg-amber-700 px-3 py-2 text-xs font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700">Confirmar actualización</button></div>
              </div>
            ) : null}
          </section>

          <section className="min-w-0 rounded-xl border border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div><p className="text-sm font-semibold text-slate-900">Resultados de enriquecimiento</p><p className="mt-1 text-sm text-slate-600">La salida conserva las columnas originales y su orden.</p></div>
              <span className="w-fit rounded-full bg-amber-100 px-3 py-1 text-xs font-bold tracking-wide text-amber-900">PROCEDENCIA POR REGISTRO</span>
            </div>
            {enrichmentOutput ? <div className="mt-5"><DataTable caption="Resultados de enriquecimiento" columns={enrichmentOutput.columns} rows={enrichmentOutput.rows.map((record) => ({ id: `enriched-${record.sourceRow}`, cells: record.cells }))} emptyMessage="Todavía no hay resultados." /></div> : <div className="mt-5 rounded-lg border border-dashed border-slate-300 px-4 py-10 text-center text-sm text-slate-600">Cuando enriquezcas la base, los resultados aparecerán aquí.</div>}
          </section>
        </div>
      </section>
    );
  }

  function renderCampaignsModule() {
    if (!enrichmentOutput || !batch) {
      return <EmptyModuleState title="Aún no hay datos para segmentar" description="Completa la limpieza y el enriquecimiento simulado para consultar la elegibilidad por operador y los filtros geográficos." action={<PrimaryButton type="button" onClick={() => navigate("enriquecimiento")}>Ir a enriquecimiento</PrimaryButton>} />;
    }

    return <CampaignEngine batch={summarizeBatch(batch)} output={enrichmentOutput} filters={campaignFilters} onBack={() => navigate("enriquecimiento")} onContinue={() => navigate("distribucion")} onFiltersChange={updateCampaignFilters} onSelectedCampaignsChange={updateSelectedCampaigns} selectedCampaigns={batch.distribution.selectedCampaigns} />;
  }

  function renderDistributionModule() {
    if (!enrichmentOutput || !campaignReport || !batch) {
      return <EmptyModuleState title="Primero completa las campañas" description="La distribución usa los registros enriquecidos y los filtros activos de las campañas para calcular los lotes." action={<PrimaryButton type="button" onClick={() => navigate("campanas")}>Ir a campañas</PrimaryButton>} />;
    }

    return <DistributionWorkspace batch={summarizeBatch(batch)} report={campaignReport} settings={batch.distribution} onSettingsChange={updateDistribution} onBack={() => navigate("campanas")} onContinue={() => navigate("exportacion")} />;
  }

  function renderExportModule() {
    if (!enrichmentOutput || !campaignReport) {
      return <EmptyModuleState title="Completa el enriquecimiento antes de exportar" description="La exportación requiere una base válida y enriquecida. Los lotes de campañas respetarán los filtros activos cuando haya resultados disponibles." action={<PrimaryButton type="button" onClick={() => navigate("enriquecimiento")}>Ir a enriquecimiento</PrimaryButton>} />;
    }

    if (!batch) return null;
    return <ExportWorkspace batch={summarizeBatch(batch)} filters={campaignFilters} masterOutput={masterOutput ?? enrichmentOutput} output={enrichmentOutput} report={campaignReport} settings={batch.distribution} provenances={Object.values(batch.provenanceBySourceRow)} onBack={() => navigate("distribucion")} onExportCompleted={() => setBatch((currentBatch) => currentBatch?.id === batch.id ? { ...currentBatch, exportCompletedAt: new Date().toISOString() } : currentBatch)} />;
  }

  let moduleContent: ReactNode;
  if (activeModule === "dashboard") {
    const nextModule: WorkspaceModule = !dataset
      ? "importacion"
      : !cleaning
        ? "limpieza"
        : !enrichmentOutput
          ? "enriquecimiento"
          : "campanas";
    moduleContent = <DashboardOverview batch={batch ? summarizeBatch(batch) : null} imported={dataset?.records.length ?? 0} valid={cleaning?.validRecords.length ?? null} excluded={cleaning?.excludedRecords.length ?? null} enriched={enrichmentOutput?.rows.length ?? null} campaigns={batch?.distribution.selectedCampaigns.length ?? 0} nextModule={nextModule} onNavigate={navigate} />;
  } else if (activeModule === "importacion") {
    moduleContent = renderImportModule();
  } else if (activeModule === "limpieza") {
    moduleContent = renderCleaningModule();
  } else if (activeModule === "enriquecimiento") {
    moduleContent = renderEnrichmentModule();
  } else if (activeModule === "campanas") {
    moduleContent = renderCampaignsModule();
  } else if (activeModule === "distribucion") {
    moduleContent = renderDistributionModule();
  } else if (activeModule === "exportacion") {
    moduleContent = renderExportModule();
  } else if (activeModule === "reciclaje") {
    moduleContent = <RecyclingWorkspaceV2 onCreate={(recycled) => { setBatch(recycled); setIsDemoMode(false); setError(null); }} onContinue={() => navigate("campanas")} />;
  } else {
    moduleContent = <SavedBasesPanel key={batch?.id ?? "empty"} batch={batch} onOpen={(restored) => { setBatch(restored); setIsDemoMode(false); setError(null); }} onSaved={(name) => setBatch((current) => current ? { ...current, displayName: name } : current)} onNavigate={() => navigate("dashboard")} />;
  }

  return (
    <AppShell activeModule={activeModule} batch={batch ? summarizeBatch(batch) : null} onNavigate={navigate} onOpenProcessing={openProcessing} onStartNewBatch={startNewBatch} saveState={batch ? saveState : undefined} onRetrySave={() => setSaveRetry((current) => current + 1)} workflow={workflow}>
      {error ? <div role="alert" className="mb-5 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900"><span className="font-semibold">No se pudo continuar: </span>{error}</div> : null}
      {moduleContent}
      {isNewBatchConfirmationOpen ? (
        <div role="presentation" className="fixed inset-0 z-30 grid place-items-center bg-slate-950/35 p-4">
          <section role="alertdialog" aria-modal="true" aria-labelledby="new-batch-title" className="w-full max-w-md border border-slate-200 bg-white p-5 shadow-2xl">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#174ea6]">Nueva base</p>
            <h2 id="new-batch-title" className="mt-2 text-lg font-semibold tracking-tight text-slate-950">¿Iniciar una base nueva?</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">La base activa y sus resultados dejarán de estar disponibles en esta sesión. Los archivos originales no se modifican.</p>
            <div className="mt-5 flex flex-wrap justify-end gap-2"><button type="button" onClick={() => setIsNewBatchConfirmationOpen(false)} className="min-h-9 rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#174ea6]">Cancelar</button><button type="button" onClick={confirmNewBatch} className="min-h-9 rounded-md bg-[#174ea6] px-3 text-sm font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#174ea6]">Crear nueva base</button></div>
          </section>
        </div>
      ) : null}
      {isReplaceConfirmationOpen ? (
        <div role="presentation" className="fixed inset-0 z-30 grid place-items-center bg-slate-950/35 p-4">
          <section role="alertdialog" aria-modal="true" aria-labelledby="replace-batch-title" className="w-full max-w-md border border-slate-200 bg-white p-5 shadow-2xl">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#174ea6]">Cambiar de base</p>
            <h2 id="replace-batch-title" className="mt-2 text-lg font-semibold tracking-tight text-slate-950">¿Importar un archivo distinto?</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">Se reemplazará la base activa por <span className="font-semibold text-slate-900">{pendingFile?.name}</span>. Sus resultados locales actuales dejarán de estar disponibles.</p>
            <div className="mt-5 flex flex-wrap justify-end gap-2"><button type="button" onClick={() => { setPendingFile(null); setIsReplaceConfirmationOpen(false); }} className="min-h-9 rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#174ea6]">Cancelar</button><button type="button" onClick={confirmReplaceBatch} className="min-h-9 rounded-md bg-[#174ea6] px-3 text-sm font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#174ea6]">Reemplazar e importar</button></div>
          </section>
        </div>
      ) : null}
    </AppShell>
  );
}
