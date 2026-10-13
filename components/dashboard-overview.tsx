import { StatusCard } from "@/components/status-card";
import type { WorkspaceModule } from "@/components/app-shell";
import type { BatchSummary } from "@/lib/workspace/batch";

interface DashboardOverviewProps {
  batch: BatchSummary | null;
  campaigns: number;
  enriched: number | null;
  excluded: number | null;
  imported: number;
  nextModule: WorkspaceModule;
  onNavigate: (module: WorkspaceModule) => void;
  valid: number | null;
}

const nextActionLabels: Record<WorkspaceModule, string> = {
  dashboard: "Ver resumen",
  importacion: "Importar base",
  limpieza: "Continuar a limpieza",
  enriquecimiento: "Continuar a enriquecimiento",
  campanas: "Revisar campañas",
  distribucion: "Preparar distribución",
  exportacion: "Ir a exportación",
};

function formatCreatedAt(value: string): string {
  return new Intl.DateTimeFormat("es-ES", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function DashboardOverview({
  batch,
  campaigns,
  enriched,
  excluded,
  imported,
  nextModule,
  onNavigate,
  valid,
}: DashboardOverviewProps) {
  return (
    <section aria-labelledby="dashboard-title" className="space-y-5">
      <div className="flex flex-col gap-4 border-b border-slate-200 pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#174ea6]">Centro de operaciones</p>
          <h2 id="dashboard-title" className="mt-1 text-2xl font-semibold tracking-tight text-[#0f274f] sm:text-3xl">{batch ? "Estado de la base" : "Prepara una base de trabajo"}</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">{batch ? "Consulta el avance sin mostrar contactos ni datos identificativos en este panel." : "Importa un Excel para crear una base independiente que se procesa únicamente en esta sesión."}</p>
        </div>
        <button type="button" onClick={() => onNavigate(nextModule)} className="inline-flex min-h-10 items-center justify-center rounded-md bg-[#174ea6] px-4 text-sm font-semibold text-white transition-colors hover:bg-[#123f87] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#174ea6]">
          {nextActionLabels[nextModule]}
        </button>
      </div>

      {batch ? (
        <section aria-label="Base activa" className="border border-slate-200 bg-white">
          <div className="flex flex-col gap-3 border-b border-slate-200 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">Base activa</p>
              <p className="mt-1 truncate text-sm font-semibold text-slate-900" title={batch.fileName}>{batch.fileName}</p>
              <p className="mt-1 text-xs text-slate-500">Creada {formatCreatedAt(batch.createdAt)} · ID {batch.id.slice(0, 8)}</p>
            </div>
            <span className="inline-flex w-fit rounded-md border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-semibold text-[#174ea6]">{batch.status.replaceAll("_", " ")}</span>
          </div>
          <div className="grid divide-y divide-slate-200 sm:grid-cols-5 sm:divide-x sm:divide-y-0">
            <StatusCard label="Importados" value={imported} tone="blue" hint="Archivo activo" />
            <StatusCard label="Válidos" value={valid ?? "—"} tone="emerald" hint="Tras limpieza" />
            <StatusCard label="Excluidos" value={excluded ?? "—"} tone="rose" hint="Reglas aplicadas" />
            <StatusCard label="Enriquecidos" value={enriched ?? "—"} tone="violet" hint="Salida simulada" />
            <StatusCard label="Campañas" value={campaigns} tone="slate" hint="Ofertas activas" />
          </div>
        </section>
      ) : (
        <section className="border border-dashed border-slate-300 bg-white px-5 py-10 text-center">
          <p className="text-sm font-semibold text-slate-900">No hay una base activa</p>
          <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-slate-600">Cada importación inicia una base aislada. Los datos se mantienen solo mientras la página sigue abierta.</p>
          <button type="button" onClick={() => onNavigate("importacion")} className="mt-5 text-sm font-semibold text-[#174ea6] underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#174ea6]">Seleccionar un Excel</button>
        </section>
      )}

      <section className="border-t border-slate-200 pt-4 text-sm text-slate-600">
        <p><span className="font-semibold text-slate-900">Siguiente paso:</span> {batch ? nextActionLabels[nextModule].toLocaleLowerCase("es-ES") : "importa un archivo para comenzar."}</p>
      </section>
    </section>
  );
}
