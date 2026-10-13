import { StatusCard } from "@/components/status-card";
import type { WorkspaceModule } from "@/components/app-shell";

interface DashboardOverviewProps {
  imported: number;
  valid: number | null;
  excluded: number | null;
  enriched: number | null;
  campaigns: number;
  onNavigate: (module: WorkspaceModule) => void;
}

export function DashboardOverview({
  imported,
  valid,
  excluded,
  enriched,
  campaigns,
  onNavigate,
}: DashboardOverviewProps) {
  const hasImportedData = imported > 0;

  return (
    <section aria-labelledby="dashboard-title" className="space-y-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-blue-700">Resumen operativo</p>
          <h2 id="dashboard-title" className="mt-1 text-2xl font-semibold tracking-tight text-[#10234a] sm:text-3xl">Control de la base</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">Sigue el proceso de tu base sin exponer contactos ni datos identificativos en esta vista.</p>
        </div>
        <button type="button" onClick={() => onNavigate(hasImportedData ? "limpieza" : "importacion")} className="inline-flex min-h-10 items-center justify-center rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-blue-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600">
          {hasImportedData ? "Continuar proceso" : "Importar base"}
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <StatusCard label="Importados" value={imported} tone="blue" hint="Registros del archivo" />
        <StatusCard label="Válidos" value={valid ?? "—"} tone="emerald" hint="Aptos tras limpieza" />
        <StatusCard label="Excluidos" value={excluded ?? "—"} tone="rose" hint="Con una regla aplicada" />
        <StatusCard label="Enriquecidos" value={enriched ?? "—"} tone="violet" hint="Salida disponible" />
        <StatusCard label="Campañas" value={campaigns} tone="slate" hint="Módulos disponibles" />
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)] sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-slate-900">Estado del espacio de trabajo</p>
            <p className="mt-1 max-w-xl text-sm leading-6 text-slate-600">
              {hasImportedData
                ? "La base se mantiene en memoria mientras cambias de módulo. Revisa el siguiente paso del flujo para continuar."
                : "Aún no hay una base cargada. Comienza importando un archivo Excel desde tu equipo."}
            </p>
          </div>
          <span className={`inline-flex w-fit rounded-full px-3 py-1.5 text-xs font-bold ${hasImportedData ? "bg-blue-50 text-blue-800" : "bg-slate-100 text-slate-600"}`}>
            {hasImportedData ? "Base cargada localmente" : "Sin archivo cargado"}
          </span>
        </div>
      </section>
    </section>
  );
}
