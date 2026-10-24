"use client";

import type { ReactNode } from "react";
import type { BatchSummary } from "@/lib/workspace/batch";
import { LogoutButton } from "@/components/logout-button";

export type WorkspaceModule = "dashboard" | "bases" | "reciclaje" | "importacion" | "limpieza" | "enriquecimiento" | "campanas" | "distribucion" | "exportacion";

const primaryModules = [
  { id: "dashboard", label: "Inicio", description: "Resumen y actividad" },
  { id: "procesar", label: "Procesar base", description: "Importar, validar y exportar" },
  { id: "bases", label: "Mis bases", description: "Historial en Neon" },
  { id: "reciclaje", label: "Reciclaje", description: "Consolidación CRM" },
] as const;

export interface WorkflowStep {
  id: string;
  label: string;
  module: WorkspaceModule;
  state: "complete" | "current" | "pending";
}

interface AppShellProps {
  activeModule: WorkspaceModule;
  batch: BatchSummary | null;
  children: ReactNode;
  onNavigate: (module: WorkspaceModule) => void;
  onOpenProcessing: () => void;
  onStartNewBatch: () => void;
  workflow: readonly WorkflowStep[];
}

const statusLabels = {
  lista_para_limpiar: "Pendiente de limpieza",
  lista_para_enriquecer: "Limpieza completada",
  lista_para_distribuir: "Lista para distribuir",
} as const;

function Workflow({ onNavigate, workflow }: { onNavigate: (module: WorkspaceModule) => void; workflow: readonly WorkflowStep[] }) {
  return (
    <nav aria-label="Flujo de procesamiento" className="overflow-x-auto pb-1">
      <ol className="flex min-w-[710px] items-center border-y border-slate-200 bg-white px-3 py-2 sm:px-4">
        {workflow.map((step, index) => (
          <li key={step.id} className="flex min-w-0 flex-1 items-center last:flex-none">
            <button
              type="button"
              onClick={() => onNavigate(step.module)}
              aria-current={step.state === "current" ? "step" : undefined}
              className="group flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
            >
              <span
                aria-label={`${step.label}: ${step.state === "complete" ? "completado" : step.state === "current" ? "en curso" : "pendiente"}`}
                className={`grid h-6 w-6 shrink-0 place-items-center rounded-full border text-[11px] font-bold ${
                  step.state === "complete"
                    ? "border-[#174ea6] bg-[#174ea6] text-white"
                    : step.state === "current"
                      ? "border-[#174ea6] bg-blue-50 text-[#174ea6]"
                      : "border-slate-300 bg-slate-50 text-slate-500"
                }`}
              >
                {step.state === "complete" ? "✓" : index + 1}
              </span>
              <span className={`whitespace-nowrap text-xs font-semibold ${step.state === "pending" ? "text-slate-500" : "text-slate-800"}`}>
                {step.label}
              </span>
            </button>
            {index < workflow.length - 1 ? (
              <span aria-hidden="true" className={`mx-1 h-px min-w-4 flex-1 ${step.state === "complete" ? "bg-blue-300" : "bg-slate-200"}`} />
            ) : null}
          </li>
        ))}
      </ol>
    </nav>
  );
}

export function AppShell({ activeModule, batch, children, onNavigate, onOpenProcessing, onStartNewBatch, workflow }: AppShellProps) {
  const isProcessing = ["importacion", "limpieza", "enriquecimiento", "campanas", "distribucion", "exportacion"].includes(activeModule);
  const activeItem = isProcessing ? { label: "Procesar base" } : primaryModules.find((item) => item.id === activeModule) ?? primaryModules[0];

  return (
    <div className="min-h-screen bg-[#f8fafc] text-slate-900">
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-64 flex-col border-r border-slate-800 bg-[#101828] px-3 py-5 text-slate-200 lg:flex">
        <div className="border-b border-slate-800 px-3 pb-5">
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-blue-300">Data-base</p>
          <p className="mt-2 text-lg font-semibold tracking-tight text-white">Operaciones de bases</p>
          <p className="mt-1 text-xs leading-5 text-slate-400">Preparación, campañas y trazabilidad.</p>
        </div>

        <p className="mt-7 px-3 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Navegación</p>
        <nav aria-label="Secciones principales" className="mt-2 space-y-1">
          {primaryModules.map((item) => {
            const active = item.id === "procesar" ? isProcessing : item.id === activeModule;
            return <button key={item.id} type="button" onClick={() => item.id === "procesar" ? onOpenProcessing() : onNavigate(item.id)} aria-current={active ? "page" : undefined} className={`w-full rounded-md px-3 py-2.5 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-300 ${active ? "bg-[#1d4f9f] text-white" : "text-slate-300 hover:bg-slate-800 hover:text-white"}`}><span className="block text-sm font-semibold">{item.label}</span><span className={`mt-0.5 block text-[11px] ${active ? "text-blue-100" : "text-slate-500"}`}>{item.description}</span></button>;
          })}
        </nav>

        <div className="mt-auto border-t border-slate-800 px-3 pt-4 text-xs leading-5 text-slate-400">
          <p className="font-medium text-slate-300">Base aislada por sesión</p>
          <p className="mt-1">Guarda el avance en Mis bases cuando lo necesites.</p>
        </div>
      </aside>

      <div className="lg:pl-64">
        <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 px-4 py-2.5 backdrop-blur sm:px-6 lg:px-8">
          <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">{batch ? "Base de trabajo activa" : "Espacio de trabajo"}</p>
              <div className="flex min-w-0 items-center gap-2">
                <h1 className="truncate text-base font-semibold tracking-tight text-[#0f274f]">{batch ? batch.fileName : activeItem.label}</h1>
                {batch ? <><span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ${batch.kind === "RECICLADA" ? "border border-violet-200 bg-violet-50 text-violet-800" : "border border-slate-200 bg-slate-50 text-slate-600"}`}>{batch.kind}</span><span className="shrink-0 rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[10px] text-slate-500">{batch.id.slice(0, 8)}</span></> : null}
              </div>
              {batch ? <p className="truncate text-[11px] text-slate-500">{batch.records} registros · {statusLabels[batch.status]} · Cambios locales</p> : null}
            </div>
            <label className="block lg:hidden">
              <span className="sr-only">Cambiar de módulo</span>
              <select
                value={isProcessing ? "procesar" : activeModule}
                onChange={(event) => event.target.value === "procesar" ? onOpenProcessing() : onNavigate(event.target.value as WorkspaceModule)}
                className="min-h-10 max-w-48 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-800 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
              >
                {primaryModules.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex items-center gap-2 sm:hidden">
              <button type="button" onClick={onStartNewBatch} className="inline-flex min-h-10 items-center justify-center rounded-md bg-[#174ea6] px-3 text-xs font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#174ea6]">Nueva</button>
              <LogoutButton />
            </div>
            <div className="hidden items-center gap-2 sm:flex">
              <span className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-medium text-slate-600">Administrador</span>
              <button type="button" onClick={onStartNewBatch} className="inline-flex min-h-9 items-center justify-center rounded-md bg-[#174ea6] px-3 text-xs font-semibold text-white transition-colors hover:bg-[#123f87] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#174ea6]">Nueva base</button>
              <LogoutButton />
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-[1440px] px-4 py-4 sm:px-6 lg:px-8 lg:py-5">
          <Workflow onNavigate={onNavigate} workflow={workflow} />
          <div className="mt-5">{children}</div>
        </main>
      </div>
    </div>
  );
}
