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
  dashboard: "Ver resumen", bases: "Ver mis bases", reciclaje: "Abrir reciclaje", ventas: "Abrir ventas",
  importacion: "Importar base", limpieza: "Continuar a limpieza", enriquecimiento: "Continuar a enriquecimiento",
  campanas: "Revisar campañas", distribucion: "Preparar distribución", exportacion: "Ir a exportación",
};

function formatCreatedAt(value: string): string {
  return new Intl.DateTimeFormat("es-ES", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function statusLabel(status: string): string {
  return status.replaceAll("_", " ").toLocaleLowerCase("es-ES");
}

export function DashboardOverview({ batch, campaigns, enriched, excluded, imported, nextModule, onNavigate, valid }: DashboardOverviewProps) {
  const nextAction = nextActionLabels[nextModule];

  return (
    <section aria-labelledby="dashboard-title" className="space-y-6">
      <header className="grid gap-6 border-b border-slate-200 pb-6 lg:grid-cols-[minmax(0,1fr)_minmax(260px,0.34fr)] lg:items-end">
        <div className="max-w-3xl">
          <h2 id="dashboard-title" className="text-3xl font-semibold tracking-[-0.025em] text-[#101b2f] sm:text-4xl">{batch ? "Operación de la base activa" : "Prepara la siguiente base"}</h2>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">{batch ? "Revisa el estado operativo y continúa desde el punto validado. Este resumen no expone contactos ni datos identificativos." : "Inicia una base de trabajo independiente. La importación, limpieza y decisiones posteriores conservan el orden y la procedencia del archivo."}</p>
        </div>
        <div className="border-l-2 border-[#174ea6] pl-4 lg:pb-0.5">
          <p className="text-xs font-medium text-slate-500">Siguiente acción</p>
          <button type="button" onClick={() => onNavigate(nextModule)} className="mt-2 inline-flex min-h-10 w-full items-center justify-center rounded-md bg-[#174ea6] px-4 text-sm font-semibold text-white transition-colors hover:bg-[#123f87] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#174ea6]">{nextAction}</button>
        </div>
      </header>

      {batch ? (
        <>
          <section aria-label="Contexto de la base activa" className="grid overflow-hidden border border-slate-200 bg-white lg:grid-cols-[minmax(0,1.35fr)_minmax(260px,0.65fr)]">
            <div className="min-w-0 px-5 py-5 sm:px-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0"><p className="text-sm font-semibold text-slate-950">{batch.fileName}</p><p className="mt-1 text-xs leading-5 text-slate-500">Creada {formatCreatedAt(batch.createdAt)} · Identificador {batch.id.slice(0, 8)}</p></div>
                <span className="inline-flex w-fit border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-semibold text-[#174ea6]">{statusLabel(batch.status)}</span>
              </div>
              <div className="mt-7 border-t border-slate-100 pt-4"><p className="text-xs font-medium text-slate-500">Lectura operativa</p><p className="mt-1 text-sm leading-6 text-slate-700">La base queda aislada por sesión hasta que se guarde en la biblioteca. El avance se mantiene por etapa y no confirma una distribución comercial.</p></div>
            </div>
            <aside className="border-t border-slate-200 bg-slate-50 px-5 py-5 lg:border-t-0 lg:border-l sm:px-6" aria-label="Acción recomendada">
              <p className="text-sm font-semibold text-slate-900">Continuidad del trabajo</p><p className="mt-2 text-sm leading-6 text-slate-600">La ruta disponible depende de las validaciones ya completadas, no de una estimación visual.</p>
              <button type="button" onClick={() => onNavigate(nextModule)} className="mt-5 text-sm font-semibold text-[#174ea6] underline decoration-blue-200 underline-offset-4 hover:decoration-[#174ea6] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#174ea6]">{nextAction}</button>
            </aside>
          </section>
          <section aria-label="Indicadores de la base activa" className="border-y border-slate-200 bg-white"><div className="grid divide-y divide-slate-200 sm:grid-cols-2 sm:divide-x sm:divide-y-0 lg:grid-cols-5"><StatusCard label="Importados" value={imported} tone="blue" hint="Archivo activo" /><StatusCard label="Válidos" value={valid ?? "—"} tone="emerald" hint="Tras limpieza" /><StatusCard label="Excluidos" value={excluded ?? "—"} tone="rose" hint="Reglas aplicadas" /><StatusCard label="Enriquecidos" value={enriched ?? "—"} tone="violet" hint="Salida disponible" /><StatusCard label="Campañas" value={campaigns} tone="slate" hint="Configuradas" /></div></section>
        </>
      ) : (
        <section className="grid border border-slate-200 bg-white lg:grid-cols-[minmax(0,1.15fr)_minmax(260px,0.85fr)]">
          <div className="px-5 py-7 sm:px-7"><h3 className="text-lg font-semibold tracking-[-0.015em] text-slate-950">Inicia desde el archivo de origen</h3><p className="mt-2 max-w-xl text-sm leading-6 text-slate-600">Selecciona un Excel para crear una base independiente. No se creará una campaña, reserva ni contacto mientras no completes las etapas operativas.</p><button type="button" onClick={() => onNavigate("importacion")} className="mt-6 inline-flex min-h-10 items-center justify-center rounded-md bg-[#174ea6] px-4 text-sm font-semibold text-white transition-colors hover:bg-[#123f87] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#174ea6]">Seleccionar un Excel</button></div>
          <aside className="border-t border-slate-200 bg-slate-50 px-5 py-7 sm:px-7 lg:border-t-0 lg:border-l" aria-label="Secuencia de preparación"><h3 className="text-sm font-semibold text-slate-900">Antes de distribuir</h3><ol className="mt-4 space-y-3 text-sm text-slate-600"><li className="flex gap-3"><span className="font-semibold text-[#174ea6]">1</span><span>Importar y conservar la estructura del archivo.</span></li><li className="flex gap-3"><span className="font-semibold text-[#174ea6]">2</span><span>Limpiar y validar los móviles operativos.</span></li><li className="flex gap-3"><span className="font-semibold text-[#174ea6]">3</span><span>Revisar campañas y controles comerciales.</span></li></ol></aside>
        </section>
      )}
    </section>
  );
}
