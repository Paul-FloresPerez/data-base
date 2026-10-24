"use client";

import type { ChangeEvent, InputHTMLAttributes } from "react";
import { useDeferredValue, useMemo, useRef, useState } from "react";

import { DataTable } from "@/components/data-table";
import {
  analyzeRecyclingFiles,
  candidateTipifications,
  followUpTipifications,
  recyclingToBatch,
  type RecyclingAnalysis,
  type RecyclingInput,
} from "@/lib/recycling/recycling";
import type { WorkingBatch } from "@/lib/workspace/batch";

const exceptionPageSize = 10;
const selectableTipifications = [...candidateTipifications, ...followUpTipifications];
const directWorkbookLimit = 30 * 1024 * 1024;
const sourceLimit = 500;

type ExceptionFilter = "all" | "revision" | "bloqueado";
type SourceIssue = { fileName: string; reason: string };
type ImportProgress = { processed: number; total: number; valid: number; failed: number; duplicates: number };
type DirectoryInputProps = InputHTMLAttributes<HTMLInputElement> & { webkitdirectory?: string; directory?: string };

function sourcePath(file: File): string {
  return (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
}

function isTemporaryOrHidden(path: string): boolean {
  return /(^|[/\\])(?:~\$|\.)/.test(path);
}

function importMessage(progress: ImportProgress, issues: SourceIssue[], cancelled: boolean): string {
  const duplicateText = progress.duplicates ? `, ${progress.duplicates} duplicados omitidos` : "";
  return `${cancelled ? "Importación cancelada. Resultado parcial" : "Importación terminada"}: ${progress.valid} Excel válidos, ${progress.failed} fallidos${duplicateText}.${issues.length ? " Revisa las incidencias antes de consolidar." : ""}`;
}

export function RecyclingWorkspaceV2({ onCreate, onContinue }: { onCreate: (batch: WorkingBatch) => void; onContinue: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const cancelImport = useRef(false);
  const [analysis, setAnalysis] = useState<RecyclingAnalysis | null>(null);
  const [selectedTipifications, setSelectedTipifications] = useState<Set<string>>(() => new Set(candidateTipifications));
  const [query, setQuery] = useState("");
  const [exceptionFilter, setExceptionFilter] = useState<ExceptionFilter>("all");
  const [page, setPage] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [issues, setIssues] = useState<SourceIssue[]>([]);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [createdBatch, setCreatedBatch] = useState<WorkingBatch | null>(null);
  const deferredQuery = useDeferredValue(query.trim().toLocaleLowerCase("es-ES"));
  const importing = progress !== null && progress.processed < progress.total;

  async function load(files: FileList | null) {
    if (!files?.length || importing) return;
    cancelImport.current = false;
    setMessage(null);
    setIssues([]);
    setCreatedBatch(null);
    const rejected: SourceIssue[] = [];
    const workbooks: { fileName: string; zipName?: string; internalPath?: string; bytes: ArrayBuffer; fingerprint: string }[] = [];
    const fingerprints = new Set<string>();
    let duplicates = 0;
    try {
      const archive = await import("@/lib/recycling/archive-import");
      for (const file of Array.from(files)) {
        if (cancelImport.current) break;
        const path = sourcePath(file);
        if (isTemporaryOrHidden(path)) continue;
        if (/\.zip$/i.test(file.name)) {
          const extracted = await archive.extractArchiveWorkbooks(file.name, await file.arrayBuffer());
          rejected.push(...extracted.rejected);
          for (const source of extracted.workbooks) {
            if (workbooks.length >= sourceLimit) {
              rejected.push({ fileName: source.fileName, reason: "Se alcanzó el límite de 500 Excel por operación." });
            } else if (fingerprints.has(source.fingerprint)) {
              duplicates += 1;
            } else {
              fingerprints.add(source.fingerprint);
              workbooks.push(source);
            }
          }
          continue;
        }
        if (!/\.xlsx$/i.test(file.name)) {
          rejected.push({ fileName: path, reason: "Formato no admitido; se aceptan XLSX y ZIP." });
          continue;
        }
        if (file.size > directWorkbookLimit) {
          rejected.push({ fileName: path, reason: "El Excel supera el límite de 30 MB por archivo." });
          continue;
        }
        if (workbooks.length >= sourceLimit) {
          rejected.push({ fileName: path, reason: "Se alcanzó el límite de 500 Excel por operación." });
          continue;
        }
        const bytes = await file.arrayBuffer();
        const fingerprint = await archive.fingerprintBytes(bytes);
        if (fingerprints.has(fingerprint)) {
          duplicates += 1;
        } else {
          fingerprints.add(fingerprint);
          workbooks.push({ fileName: file.name, internalPath: path === file.name ? undefined : path, bytes, fingerprint });
        }
      }
      setProgress({ processed: 0, total: workbooks.length, valid: 0, failed: rejected.length, duplicates });
      if (!workbooks.length) {
        setIssues(rejected);
        setProgress(null);
        setMessage(rejected.length ? "No hay Excel válidos para consolidar." : "No se encontraron Excel admitidos.");
        return;
      }
      const imported = await import("xlsx");
      const XLSX = imported.default ?? imported;
      const parsed: RecyclingInput[] = [];
      let completed = 0;
      let valid = 0;
      for (const source of workbooks) {
        if (cancelImport.current) break;
        try {
          const workbook = XLSX.read(source.bytes, { cellText: true });
          const sheetName = workbook.SheetNames.find((name) => name.toLocaleLowerCase("es-ES") === "datos") ?? workbook.SheetNames[0];
          if (!sheetName || !workbook.Sheets[sheetName]) throw new Error("El libro no contiene una hoja legible.");
          const rows = XLSX.utils.sheet_to_json<string[]>(workbook.Sheets[sheetName], { header: 1, raw: false, defval: "" });
          if (!rows.length || !(rows[0] ?? []).some((cell) => String(cell).trim())) throw new Error("La hoja no contiene encabezados legibles.");
          parsed.push({ fileName: source.fileName, zipName: source.zipName, internalPath: source.internalPath, sheetName, columns: (rows[0] ?? []).map(String), rows: rows.slice(1).map((row) => row.map(String)) });
          valid += 1;
        } catch (caught) {
          rejected.push({ fileName: source.internalPath ?? source.fileName, reason: caught instanceof Error ? caught.message : "Excel corrupto o no legible." });
        }
        completed += 1;
        setProgress({ processed: completed, total: workbooks.length, valid, failed: rejected.length, duplicates });
        await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
      }
      if (parsed.length) {
        setAnalysis(analyzeRecyclingFiles(parsed));
        setSelectedTipifications(new Set(candidateTipifications));
        setQuery("");
        setExceptionFilter("all");
        setPage(0);
      } else {
        setAnalysis(null);
      }
      const completedProgress = { processed: completed, total: workbooks.length, valid, failed: rejected.length, duplicates };
      setIssues(rejected);
      setMessage(importMessage(completedProgress, rejected, cancelImport.current));
    } catch {
      setMessage("No se pudo preparar la importación local. No se envió ningún archivo.");
    } finally {
      setProgress(null);
    }
  }

  function handleInput(event: ChangeEvent<HTMLInputElement>) {
    const files = event.target.files;
    event.target.value = "";
    void load(files);
  }

  const selectedCount = useMemo(() => analysis?.winners.filter((record) => record.bucket !== "bloqueado" && selectedTipifications.has(record.tipification)).length ?? 0, [analysis, selectedTipifications]);
  const exceptions = useMemo(() => {
    if (!analysis) return [];
    return analysis.winners.filter((record) => record.reviewReason).filter((record) => {
      const matchesFilter = exceptionFilter === "all" || record.bucket === exceptionFilter;
      const haystack = `${record.zipName ?? ""} ${record.internalPath ?? ""} ${record.fileName} ${record.sheetName} ${record.mobile} ${record.tipification} ${record.reviewReason}`.toLocaleLowerCase("es-ES");
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

  const fileInputs = <><input ref={input} className="sr-only" type="file" accept=".xlsx,.zip,application/zip,application/x-zip-compressed" multiple onChange={handleInput} /><input ref={folderInput} className="sr-only" type="file" accept=".xlsx" multiple {...({ webkitdirectory: "", directory: "", onChange: handleInput } satisfies DirectoryInputProps)} /></>;
  const importControls = <div className="flex flex-wrap gap-2"><button type="button" disabled={importing} onClick={() => input.current?.click()} className="rounded-md bg-[#174ea6] px-4 py-2.5 text-sm font-semibold text-white disabled:bg-slate-300">{importing ? "Procesando…" : "Seleccionar Excel o ZIP"}</button><button type="button" disabled={importing} onClick={() => folderInput.current?.click()} className="rounded-md border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 disabled:opacity-60">Carpeta de Excel</button></div>;
  const progressPanel = progress ? <section className="border border-blue-200 bg-blue-50 p-4 text-sm text-blue-950"><p className="font-semibold">Procesando {progress.processed} de {progress.total} Excel</p><p className="mt-1">Válidos: {progress.valid} · Fallidos: {progress.failed} · Duplicados omitidos: {progress.duplicates}</p><button type="button" onClick={() => { cancelImport.current = true; }} className="mt-3 font-semibold text-[#174ea6]">Cancelar importación</button></section> : null;
  const issuePanel = issues.length ? <details className="border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950"><summary className="cursor-pointer font-semibold">{issues.length} archivo{issues.length === 1 ? " con incidencia" : "s con incidencias"}</summary><ul className="mt-2 max-h-44 space-y-1 overflow-auto text-xs">{issues.map((issue, index) => <li key={`${issue.fileName}-${index}`}><span className="font-medium">{issue.fileName}</span>: {issue.reason}</li>)}</ul></details> : null;

  if (!analysis) {
    return <section className="space-y-5"><div className="border-b border-slate-200 pb-5"><p className="text-[10px] font-bold uppercase tracking-[.14em] text-[#174ea6]">Consolidación local</p><h2 className="mt-1 text-2xl font-semibold text-[#0f274f]">Reciclaje CRM</h2><p className="mt-2 max-w-3xl text-sm text-slate-600">Importa varios XLSX o ZIP con subcarpetas. Todo se procesa en este navegador y no se envía a Neon ni a una API.</p></div>{fileInputs}{importControls}<p className="text-xs text-slate-500">Límites: 500 Excel, 30 MB por Excel, 250 MB por ZIP comprimido y 750 MB descomprimidos por ZIP. La carpeta es opcional y depende del navegador.</p>{progressPanel}{message ? <p role="status" className="text-sm text-slate-700">{message}</p> : null}{issuePanel}</section>;
  }

  const summary: [string, number][] = [["Archivos válidos", analysis.files.length], ["Gestiones", analysis.records.length], ["Móviles únicos", analysis.counts.moviles], ["Duplicados", analysis.counts.duplicados], ["Candidatos", analysis.counts.candidato], ["Exportables", selectedCount]];
  return <section className="space-y-5"><div className="flex flex-col gap-4 border-b border-slate-200 pb-5 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-[10px] font-bold uppercase tracking-[.14em] text-[#174ea6]">Revisión humana requerida</p><h2 className="mt-1 text-2xl font-semibold text-[#0f274f]">Reciclaje consolidado</h2><p className="mt-2 text-sm text-slate-600">La base reciclada contiene solo los seleccionados; el historial CRM se conserva separado y nunca se exporta.</p></div><button type="button" onClick={() => input.current?.click()} className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700">Importar otros archivos</button></div><input ref={input} className="sr-only" type="file" accept=".xlsx" multiple onChange={(event) => void load(event.target.files)} /><dl className="grid grid-cols-2 border border-slate-200 bg-white sm:grid-cols-3 lg:grid-cols-6">{summary.map(([label, value]) => <div key={label} className="border-b border-r border-slate-100 px-3 py-2 last:border-r-0 lg:border-b-0"><dt className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{label}</dt><dd className="mt-1 text-lg font-semibold text-slate-900">{value}</dd></div>)}</dl><section className="border border-slate-200 bg-white p-4"><div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-sm font-semibold">Candidatos por tipificación</p><p className="mt-1 text-xs text-slate-500">NO RESPONDE, BUZÓN DE VOZ y CORTA LLAMADA se seleccionan inicialmente. AGENDADO es seguimiento opcional.</p></div><p className="text-sm font-semibold text-[#174ea6]">{selectedCount} para evaluación comercial</p></div><div className="mt-3 flex flex-wrap gap-2">{selectableTipifications.map((type) => <label key={type} className={`cursor-pointer rounded-md border px-3 py-2 text-sm ${selectedTipifications.has(type) ? "border-blue-600 bg-blue-50 text-blue-900" : "border-slate-200 text-slate-700"}`}><input type="checkbox" checked={selectedTipifications.has(type)} onChange={() => changeSelection(type)} className="sr-only" />{type} <span className="ml-1 font-mono text-xs">{analysis.tipifications[type] ?? 0}</span></label>)}<button type="button" onClick={() => { setSelectedTipifications(new Set(selectableTipifications)); setCreatedBatch(null); }} className="px-2 text-xs font-semibold text-[#174ea6]">Todas</button><button type="button" onClick={() => { setSelectedTipifications(new Set()); setCreatedBatch(null); }} className="px-2 text-xs font-semibold text-[#174ea6]">Ninguna</button></div><button type="button" disabled={selectedCount === 0} onClick={generateBatch} className="mt-4 rounded-md bg-[#174ea6] px-4 py-2 text-sm font-semibold text-white disabled:bg-slate-300">Generar base reciclada</button></section>{createdBatch ? <section role="status" className="flex flex-col gap-3 border border-emerald-200 bg-emerald-50 p-4 sm:flex-row sm:items-center sm:justify-between"><p className="text-sm text-emerald-900"><span className="font-semibold">Base reciclada creada:</span> {createdBatch.dataset.records.length} registros operativos · <span className="font-mono">{createdBatch.id.slice(0, 8)}</span>.</p><button type="button" onClick={onContinue} className="rounded-md bg-[#174ea6] px-4 py-2 text-sm font-semibold text-white">Continuar a campañas</button></section> : null}<section className="border border-slate-200 bg-white p-4"><div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-sm font-semibold">Excepciones y bloqueos</p><p className="mt-1 text-xs text-slate-500">Pendientes de revisión o bloqueados; no se consideran habilitados para contactar.</p></div><div className="flex gap-2"><input value={query} onChange={(event) => { setQuery(event.target.value); setPage(0); }} placeholder="Buscar" className="min-h-9 rounded-md border border-slate-300 px-2 text-sm" /><select value={exceptionFilter} onChange={(event) => { setExceptionFilter(event.target.value as ExceptionFilter); setPage(0); }} className="min-h-9 rounded-md border border-slate-300 bg-white px-2 text-sm"><option value="all">Todas</option><option value="revision">Revisión</option><option value="bloqueado">Bloqueados</option></select></div></div><div className="mt-4"><DataTable caption="Excepciones del reciclaje" columns={["Estado", "Tipificación", "Archivo", "Hoja", "Fila", "Motivo"]} rows={exceptionRows.map((record) => ({ id: String(record.sourceRow), cells: [record.bucket, record.tipification || "Sin tipificación", record.fileName, record.sheetName, String(record.originRow), record.reviewReason ?? "Pendiente de revisión"] }))} emptyMessage="No hay excepciones con los filtros actuales." /></div>{exceptions.length > exceptionPageSize ? <div className="mt-3 flex items-center justify-end gap-3 text-sm"><button type="button" disabled={page === 0} onClick={() => setPage((current) => current - 1)} className="font-semibold text-[#174ea6] disabled:text-slate-400">Anterior</button><span>{page + 1} / {exceptionPages}</span><button type="button" disabled={page >= exceptionPages - 1} onClick={() => setPage((current) => current + 1)} className="font-semibold text-[#174ea6] disabled:text-slate-400">Siguiente</button></div> : null}</section></section>;
}
