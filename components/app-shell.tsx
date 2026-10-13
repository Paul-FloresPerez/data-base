"use client";

import type { ReactNode } from "react";

export const workspaceModules = [
  { id: "dashboard", label: "Dashboard", pending: false },
  { id: "importacion", label: "Importación", pending: false },
  { id: "limpieza", label: "Limpieza", pending: false },
  { id: "enriquecimiento", label: "Enriquecimiento", pending: false },
  { id: "campanas", label: "Campañas", pending: false },
  { id: "exportacion", label: "Exportación", pending: false },
] as const;

export type WorkspaceModule = (typeof workspaceModules)[number]["id"];

export interface WorkflowStep {
  id: string;
  label: string;
  state: "complete" | "current" | "pending";
}

interface AppShellProps {
  activeModule: WorkspaceModule;
  children: ReactNode;
  onNavigate: (module: WorkspaceModule) => void;
  workflow: readonly WorkflowStep[];
}

function Workflow({ workflow }: { workflow: readonly WorkflowStep[] }) {
  return (
    <nav aria-label="Flujo de procesamiento" className="overflow-x-auto pb-1">
      <ol className="flex min-w-[640px] items-start rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-[0_1px_2px_rgba(15,23,42,0.03)] sm:px-5">
        {workflow.map((step, index) => (
          <li key={step.id} className="flex min-w-0 flex-1 items-start last:flex-none">
            <div className="flex min-w-0 flex-col items-center text-center">
              <span
                aria-label={`${step.label}: ${step.state === "complete" ? "completado" : step.state === "current" ? "en curso" : "pendiente"}`}
                className={`grid h-7 w-7 shrink-0 place-items-center rounded-full border text-xs font-bold ${
                  step.state === "complete"
                    ? "border-blue-600 bg-blue-600 text-white"
                    : step.state === "current"
                      ? "border-violet-600 bg-violet-50 text-violet-700"
                      : "border-slate-300 bg-slate-50 text-slate-500"
                }`}
              >
                {index + 1}
              </span>
              <span className={`mt-2 whitespace-nowrap text-xs font-semibold ${step.state === "pending" ? "text-slate-500" : "text-slate-800"}`}>
                {step.label}
              </span>
            </div>
            {index < workflow.length - 1 ? (
              <span aria-hidden="true" className={`mx-2 mt-3 h-px min-w-6 flex-1 ${step.state === "complete" ? "bg-blue-300" : "bg-slate-200"}`} />
            ) : null}
          </li>
        ))}
      </ol>
    </nav>
  );
}

export function AppShell({ activeModule, children, onNavigate, workflow }: AppShellProps) {
  const activeItem = workspaceModules.find((item) => item.id === activeModule) ?? workspaceModules[0];

  return (
    <div className="min-h-screen bg-[#f5f7fb] text-slate-900">
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-64 flex-col border-r border-slate-800 bg-[#0b1d3a] px-4 py-5 text-slate-200 lg:flex">
        <div className="flex items-center gap-3 px-2">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-blue-600 text-sm font-bold tracking-tight text-white">GB</span>
          <div>
            <p className="text-sm font-semibold text-white">Gestor de Bases</p>
            <p className="mt-0.5 text-xs text-slate-400">Telecom · Call Center</p>
          </div>
        </div>

        <nav aria-label="Módulos" className="mt-10 space-y-1">
          {workspaceModules.map((item) => {
            const active = item.id === activeModule;
            return (
              <button
                key={item.id}
                type="button"
                disabled={item.pending}
                onClick={() => onNavigate(item.id)}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-11 w-full items-center justify-between rounded-lg px-3 text-left text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-300 disabled:cursor-not-allowed disabled:opacity-70 ${
                  active
                    ? "bg-blue-600 text-white shadow-[0_8px_18px_rgba(15,23,42,0.24)]"
                    : "text-slate-300 hover:bg-slate-800 hover:text-white"
                }`}
              >
                <span>{item.label}</span>
                {item.pending ? <span className="rounded-full bg-slate-700 px-2 py-0.5 text-[10px] font-semibold text-slate-300">Próximamente</span> : null}
              </button>
            );
          })}
        </nav>

        <div className="mt-auto border-t border-slate-800 px-2 pt-4 text-xs leading-5 text-slate-400">
          <p className="font-medium text-slate-300">Procesamiento local</p>
          <p>Los archivos permanecen en este navegador.</p>
        </div>
      </aside>

      <div className="lg:pl-64">
        <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur sm:px-6 lg:px-8">
          <div className="mx-auto flex max-w-[1600px] items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">Espacio de trabajo</p>
              <h1 className="truncate text-lg font-semibold tracking-tight text-[#10234a]">{activeItem.label}</h1>
            </div>
            <label className="block lg:hidden">
              <span className="sr-only">Cambiar de módulo</span>
              <select
                value={activeModule}
                onChange={(event) => onNavigate(event.target.value as WorkspaceModule)}
                className="min-h-10 max-w-48 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-800 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
              >
                {workspaceModules.map((item) => (
                  <option key={item.id} value={item.id} disabled={item.pending}>
                    {item.label}{item.pending ? " · Próximamente" : ""}
                  </option>
                ))}
              </select>
            </label>
            <span className="hidden rounded-full border border-blue-100 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-800 sm:inline-flex">
              Datos en el navegador
            </span>
          </div>
        </header>

        <main className="mx-auto max-w-[1600px] px-4 py-5 sm:px-6 lg:px-8 lg:py-7">
          <Workflow workflow={workflow} />
          <div className="mt-5">{children}</div>
        </main>
      </div>
    </div>
  );
}
