"use client";

import { useDeferredValue, useMemo, useRef, useState } from "react";

import { DataTable } from "@/components/data-table";
import {
  analyzeRecyclingFiles,
  candidateTipifications,
  followUpTipifications,
  recyclingToBatch,
  type RecyclingAnalysis,
} from "@/lib/recycling/recycling";
import type { WorkingBatch } from "@/lib/workspace/batch";

const exceptionPageSize = 10;
const selectableTipifications = [...candidateTipifications, ...followUpTipifications];

type ExceptionFilter = "all" | "revision" | "bloqueado";

export function RecyclingWorkspaceV2({ onCreate, onContinue }: { onCreate: (batch: WorkingBatch) => void; onContinue: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [analysis, setAnalysis] = useState<RecyclingAnalysis | null>(null);
  const [selectedTipifications, setSelectedTipifications] = useState<Set<string>>(() => new Set(candidateTipifications));
  const [query, setQuery] = useState("");
  const [exceptionFilter, setExceptionFilter] = useState<ExceptionFilter>("all");
  const [page, setPage] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [createdBatch, setCreatedBatch] = useState<WorkingBatch | null>(null);
  const deferredQuery = useDeferredValue(query.trim().toLocaleLowerCase("es-ES"));

  async function load(files: FileList | null) {
    if (!files?.length) return;
    try {
      const imported = await import("xlsx");
      const XLSX = imported.default ?? imported;
      const parsed: { fileName: string; sheetName: string; columns: string[]; rows: string[][] }[] = [];
      for (const file of Array.from(files)) {
        const workbook = XLSX.read(await file.arrayBuffer(), { cellText: true });
        const sheetName = workbook.SheetNames.find((name) => name.toLocaleLowerCase("es-ES") === "datos") ?? workbook.SheetNames[0]!;
        const rows = XLSX.utils.sheet_to_json<string[]>(workbook.Sheets[sheetName], { header: 1, raw: false, defval: "" });
        parsed.push({ fileName: file.name, sheetName, columns: (rows[0] ?? []).map(String), rows: rows.slice(1).map((row) => row.map(String)) });
      }
      setAnalysis(analyzeRecyclingFiles(parsed));
      setSelectedTipifications(new Set(candidateTipifications));
      setCreatedBatch(null);
      setQuery("");
      setExceptionFilter("all");
      setPage(0);
      setMessage(null);
    } catch {
      setMessage("No se pudieron leer los archivos seleccionados.");
    }
  }

  const selectedCount = useMemo(() => analysis?.winners.filter((record) => record.bucket !== "bloqueado" && selectedTipifications.has(record.tipification)).length ?? 0, [analysis, selectedTipifications]);
  const exceptions = useMemo(() => {
    if (!analysis) return [];
    return analysis.winners.filter((record) => record.reviewReason).filter((record) => {
      const matchesFilter = exceptionFilter === "all" || record.bucket === exceptionFilter;
      const haystack = `${record.fileName} ${record.sheetName} ${record.mobile} ${record.tipification} ${record.reviewReason}`.toLocaleLowerCase("es-ES");
      return matchesFilter && (!deferredQuery || haystack.includes(deferredQuery));
    });
  }, [analysis, deferredQuery, exceptionFilter]);
  const exceptionPages = Math.max(1, Math.ceil(exceptions.length / exceptionPageSize));
  const exceptionRows = exceptions.slice(page * exceptionPageSize, (page + 1) * exceptionPageSize);

  function changeSelection(type: string) {
    setSelectedTipifications((current) => {
      const next = new Set(current);
      if (next.has(type)) {
        next.delete(type);
      } else {
        next.add(type);
      }
      return next;
    });
    setCreatedBatch(null);
  }

  function generateBatch() {
    if (!analysis) return;
    const batch = recyclingToBatch(analysis, selectedTipifications);
    setCreatedBatch(batch);
    onCreate(batch);
  }

  if (!analysis) {
    return <section className="space-y-5"><div className="border-b border-slate-200 pb-5"><p className="text-[10px] font-bold uppercase tracking-[.14em] text-[#174ea6]">Consolidación local</p><h2 className="mt-1 text-2xl font-semibold text-[#0f274f]">Reciclaje CRM</h2><p className="mt-2 text-sm text-slate-600">Importa varios Excel del CRM para conservar su trazabilidad y preparar candidatos para revisión comercial.</p></div><input ref={input} className="sr-only" type="file" accept=".xlsx" multiple onChange={(event) => void load(event.target.files)} /><button type="button" onClick={() => input.current?.click()} className="rounded-md bg-[#174ea6] px-4 py-2.5 text-sm font-semibold text-white">Seleccionar archivos CRM</button>{message ? <p className="text-sm text-rose-700">{message}</p> : null}</section>;
  }

  const summary: [string, number][] = [["Archivos", analysis.files.length], ["Gestiones", analysis.records.length], ["Móviles únicos", analysis.counts.moviles], ["Candidatos", analysis.counts.candidato], ["Revisión", analysis.counts.revision + analysis.counts.bloqueado], ["Exportables", selectedCount]];
  return <section className="space-y-5"><div className="flex flex-col gap-4 border-b border-slate-200 pb-5 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-[10px] font-bold uppercase tracking-[.14em] text-[#174ea6]">Revisión humana requerida</p><h2 className="mt-1 text-2xl font-semibold text-[#0f274f]">Reciclaje consolidado</h2><p className="mt-2 text-sm text-slate-600">La base reciclada contiene solo los seleccionados; el historial CRM se conserva separado y nunca se exporta.</p></div><button type="button" onClick={() => input.current?.click()} className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700">Importar otros archivos</button></div><input ref={input} className="sr-only" type="file" accept=".xlsx" multiple onChange={(event) => void load(event.target.files)} /><dl className="grid grid-cols-2 border border-slate-200 bg-white sm:grid-cols-3 lg:grid-cols-6">{summary.map(([label, value]) => <div key={label} className="border-b border-r border-slate-100 px-3 py-2 last:border-r-0 lg:border-b-0"><dt className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{label}</dt><dd className="mt-1 text-lg font-semibold text-slate-900">{value}</dd></div>)}</dl><section className="border border-slate-200 bg-white p-4"><div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-sm font-semibold">Candidatos por tipificación</p><p className="mt-1 text-xs text-slate-500">NO RESPONDE, BUZÓN DE VOZ y CORTA LLAMADA se seleccionan inicialmente. AGENDADO es seguimiento opcional.</p></div><p className="text-sm font-semibold text-[#174ea6]">{selectedCount} para evaluación comercial</p></div><div className="mt-3 flex flex-wrap gap-2">{selectableTipifications.map((type) => <label key={type} className={`cursor-pointer rounded-md border px-3 py-2 text-sm ${selectedTipifications.has(type) ? "border-blue-600 bg-blue-50 text-blue-900" : "border-slate-200 text-slate-700"}`}><input type="checkbox" checked={selectedTipifications.has(type)} onChange={() => changeSelection(type)} className="sr-only" />{type} <span className="ml-1 font-mono text-xs">{analysis.tipifications[type] ?? 0}</span></label>)}<button type="button" onClick={() => { setSelectedTipifications(new Set(selectableTipifications)); setCreatedBatch(null); }} className="px-2 text-xs font-semibold text-[#174ea6]">Todas</button><button type="button" onClick={() => { setSelectedTipifications(new Set()); setCreatedBatch(null); }} className="px-2 text-xs font-semibold text-[#174ea6]">Ninguna</button></div><button type="button" disabled={selectedCount === 0} onClick={generateBatch} className="mt-4 rounded-md bg-[#174ea6] px-4 py-2 text-sm font-semibold text-white disabled:bg-slate-300">Generar base reciclada</button></section>{createdBatch ? <section role="status" className="flex flex-col gap-3 border border-emerald-200 bg-emerald-50 p-4 sm:flex-row sm:items-center sm:justify-between"><p className="text-sm text-emerald-900"><span className="font-semibold">Base reciclada creada:</span> {createdBatch.dataset.records.length} registros operativos · <span className="font-mono">{createdBatch.id.slice(0, 8)}</span>.</p><button type="button" onClick={onContinue} className="rounded-md bg-[#174ea6] px-4 py-2 text-sm font-semibold text-white">Continuar a campañas</button></section> : null}<section className="border border-slate-200 bg-white p-4"><div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-sm font-semibold">Excepciones y bloqueos</p><p className="mt-1 text-xs text-slate-500">Pendientes de revisión o bloqueados; no se consideran habilitados para contactar.</p></div><div className="flex gap-2"><input value={query} onChange={(event) => { setQuery(event.target.value); setPage(0); }} placeholder="Buscar" className="min-h-9 rounded-md border border-slate-300 px-2 text-sm" /><select value={exceptionFilter} onChange={(event) => { setExceptionFilter(event.target.value as ExceptionFilter); setPage(0); }} className="min-h-9 rounded-md border border-slate-300 bg-white px-2 text-sm"><option value="all">Todas</option><option value="revision">Revisión</option><option value="bloqueado">Bloqueados</option></select></div></div><div className="mt-4"><DataTable caption="Excepciones del reciclaje" columns={["Estado", "Tipificación", "Archivo", "Hoja", "Fila", "Motivo"]} rows={exceptionRows.map((record) => ({ id: String(record.sourceRow), cells: [record.bucket, record.tipification || "Sin tipificación", record.fileName, record.sheetName, String(record.originRow), record.reviewReason ?? "Pendiente de revisión"] }))} emptyMessage="No hay excepciones con los filtros actuales." /></div>{exceptions.length > exceptionPageSize ? <div className="mt-3 flex items-center justify-end gap-3 text-sm"><button type="button" disabled={page === 0} onClick={() => setPage((current) => current - 1)} className="font-semibold text-[#174ea6] disabled:text-slate-400">Anterior</button><span>{page + 1} / {exceptionPages}</span><button type="button" disabled={page >= exceptionPages - 1} onClick={() => setPage((current) => current + 1)} className="font-semibold text-[#174ea6] disabled:text-slate-400">Siguiente</button></div> : null}</section></section>;
}
