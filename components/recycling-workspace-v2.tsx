"use client";

import type { ChangeEvent, InputHTMLAttributes } from "react";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";

import { DataTable } from "@/components/data-table";
import { OriginalBaseSelector } from "@/components/original-base-selector";
import {
  analyzeRecyclingFiles,
  type RecyclingAnalysis,
  type RecyclingInput,
} from "@/lib/recycling/recycling";
import { defaultRecyclableTipifications, normalizeRecyclingTipification } from "@/lib/recycling/intelligent-recycling";
import { restoreBatch, type LoadedBase } from "@/lib/persistence/workspace-persistence";
import type { WorkingBatch } from "@/lib/workspace/batch";

const exceptionPageSize = 10;
const directWorkbookLimit = 30 * 1024 * 1024;
const sourceLimit = 500;

type ExceptionFilter = "all" | "revision" | "bloqueado";
type SourceIssue = { fileName: string; reason: string };
type ImportProgress = { processed: number; total: number; valid: number; failed: number; duplicates: number };
type DirectoryInputProps = InputHTMLAttributes<HTMLInputElement> & { webkitdirectory?: string; directory?: string };
type ConciliationSummary = { totalRows: number; invalidRows: number; uniqueValidMobiles: number; uniqueFoundMobiles: number; uniqueMissingMobiles: number; duplicateRows: number; mobilesWithMultipleManagements: number; files: { fileId: string; fileName: string; totalRows: number; invalidRows: number; uniqueValidMobiles: number; uniqueFoundMobiles: number; uniqueMissingMobiles: number; duplicateRows: number; mobilesWithMultipleManagements: number; incidents: { sourceRow: number; reason: string }[] }[] };
type RecyclingResult = { id: string; baseOriginalId: string; recycledBaseId: string | null; status: string; createdAt: string; effectiveDate: string; user: string; files: string[]; criteria: { recyclableTipifications: string[] } | null; summary: Record<string, number> | null; incidentsOutsideBase: number; results: { originalRecordId: string; decision: string; reason: string }[] };
type RecyclingHistoryItem = Omit<RecyclingResult, "results">;
type GlobalExecutionItem = { id: string; status: string; ruleVersion: string; summary: Record<string, number> | null; createdAt: string; recycledBaseId: string | null; user: string; files: number; bases: number; decisions: number };
type GlobalExecutionDetail = { id: string; status: string; ruleVersion: string; criteria: unknown; summary: Record<string, number> | null; decisions: { mobileMasked: string; decision: string; reason: string }[]; nextCursor: string | null };

async function api<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const response = await fetch(input, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  if (!response.ok) throw new Error((await response.json().catch(() => null) as { error?: string } | null)?.error ?? "No se pudo completar el reciclaje.");
  return response.json() as Promise<T>;
}

function operationId() { return crypto.randomUUID(); }

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

async function downloadRecyclingReport(execution: RecyclingResult): Promise<void> {
  const xlsx = await import("xlsx");
  const workbook = xlsx.utils.book_new();
  const indicators = [
    ["Indicador", "Valor"],
    ["Ejecución", execution.id],
    ["Fecha efectiva", execution.effectiveDate],
    ["Usuario", execution.user],
    ["Archivos CRM", execution.files.join(", ")],
    ["Elegibles", String(execution.summary?.ELEGIBLE ?? 0)],
    ["Ventas bloqueadas", String(execution.summary?.BLOQUEADO_VENTA ?? 0)],
    ["Conflictos", String(execution.summary?.REVISION_CONFLICTO ?? 0)],
    ["Permanencia", String(execution.summary?.REVISION_PERMANENCIA ?? 0)],
    ["Incidencias externas", String(execution.incidentsOutsideBase)],
  ];
  const grouped = new Map<string, number>();
  for (const result of execution.results) {
    const key = `${result.decision}\u0000${result.reason}`;
    grouped.set(key, (grouped.get(key) ?? 0) + 1);
  }
  const decisions = [["Estado", "Motivo", "Cantidad"], ...[...grouped.entries()].map(([key, count]) => {
    const [decision, reason] = key.split("\u0000");
    return [decision.replaceAll("_", " "), reason, String(count)];
  })];
  xlsx.utils.book_append_sheet(workbook, xlsx.utils.aoa_to_sheet(indicators), "Indicadores");
  xlsx.utils.book_append_sheet(workbook, xlsx.utils.aoa_to_sheet(decisions), "Decisiones");
  const bytes = xlsx.write(workbook, { bookType: "xlsx", type: "array", compression: true }) as ArrayBuffer;
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `INFORME_RECICLAJE_${execution.id.slice(0, 8)}.xlsx`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function RecyclingHistory({ baseId }: { baseId: string }) {
  const [items, setItems] = useState<RecyclingHistoryItem[]>([]);
  const [detail, setDetail] = useState<RecyclingResult | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    if (!baseId) return;
    let cancelled = false;
    void api<{ executions: RecyclingHistoryItem[] }>(`/api/reciclaje?baseId=${encodeURIComponent(baseId)}`)
      .then((result) => { if (!cancelled) setItems(result.executions); })
      .catch(() => { if (!cancelled) setMessage("No se pudo cargar el historial de reciclajes."); });
    return () => { cancelled = true; };
  }, [baseId]);
  if (!baseId) return null;
  return <section className="border border-slate-200 bg-white p-4"><div className="flex items-center justify-between gap-3"><div><p className="text-sm font-semibold text-slate-900">Historial de reciclajes</p><p className="mt-1 text-xs text-slate-500">Cada ejecución es una instantánea: consultarla no la recalcula ni modifica.</p></div><span className="text-xs font-semibold text-slate-600">{items.length}</span></div>{message ? <p role="status" className="mt-3 text-xs text-rose-700">{message}</p> : null}{items.length ? <div className="mt-3 divide-y divide-slate-100 border-y border-slate-100">{items.map((item) => <div key={item.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0 text-xs text-slate-600"><p className="font-semibold text-slate-900">{item.effectiveDate} · {item.user} · {item.status.replaceAll("_", " ")}</p><p className="mt-1 truncate">{item.files.length} archivo{item.files.length === 1 ? "" : "s"} CRM · Elegibles {item.summary?.ELEGIBLE ?? 0} · Bloqueados {item.summary?.BLOQUEADO_VENTA ?? 0} · Revisión {(item.summary?.REVISION_GESTION ?? 0) + (item.summary?.REVISION_CONFLICTO ?? 0) + (item.summary?.REVISION_PERMANENCIA ?? 0) + (item.summary?.FUERA_RANGO_HISTORICO ?? 0)}</p></div><button type="button" onClick={() => void api<RecyclingResult>(`/api/reciclaje/${item.id}`).then(setDetail).catch(() => setMessage("No se pudo abrir la ejecución."))} className="shrink-0 text-xs font-semibold text-[#174ea6]">Ver decisiones</button></div>)}</div> : <p className="mt-3 text-xs text-slate-500">Aún no hay ejecuciones para esta base original.</p>}{detail ? <div className="mt-4 border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700"><div className="flex items-center justify-between gap-3"><p className="font-semibold text-slate-900">Ejecución {detail.effectiveDate} · {detail.user}</p><div className="flex gap-3"><button type="button" onClick={() => void downloadRecyclingReport(detail).catch(() => setMessage("No se pudo generar el informe."))} className="font-semibold text-[#174ea6]">Descargar informe</button><button type="button" onClick={() => setDetail(null)} className="font-semibold text-[#174ea6]">Cerrar</button></div></div><p className="mt-2">Archivos: {detail.files.join(", ") || "Sin archivo"}. Elegibles {detail.summary?.ELEGIBLE ?? 0}; ventas bloqueadas {detail.summary?.BLOQUEADO_VENTA ?? 0}; incidencias externas {detail.incidentsOutsideBase}.</p><details className="mt-3"><summary className="cursor-pointer font-semibold">Motivos conservados ({detail.results.length})</summary><ul className="mt-2 max-h-36 space-y-1 overflow-auto">{detail.results.map((result) => <li key={result.originalRecordId}>{result.decision.replaceAll("_", " ")}: {result.reason}</li>)}</ul></details></div> : null}</section>;
}

/** Read-only, paged administrative window over RG-3/RG-4 executions. */
function GlobalRecyclingHistory({ onOpen }: { onOpen: (batch: WorkingBatch) => void }) {
  const [items, setItems] = useState<GlobalExecutionItem[]>([]);
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [running, setRunning] = useState<string | null>(null);
  const [detail, setDetail] = useState<GlobalExecutionDetail | null>(null);
  const load = (next = page) => void api<{ executions: GlobalExecutionItem[]; total: number }>(`/api/reciclaje-global?page=${next}&limit=10`)
    .then((result) => { setItems(result.executions); setTotal(result.total); setPage(next); setMessage(null); })
    .catch((error: unknown) => setMessage(error instanceof Error ? error.message : "No se pudo consultar las ejecuciones globales."));
  useEffect(() => {
    void api<{ executions: GlobalExecutionItem[]; total: number }>("/api/reciclaje-global?page=0&limit=10")
      .then((result) => { setItems(result.executions); setTotal(result.total); setPage(0); })
      .catch((error: unknown) => setMessage(error instanceof Error ? error.message : "No se pudo consultar las ejecuciones globales."));
  }, []);
  async function generate(id: string) {
    setRunning(id); setMessage(null);
    try {
      const result = await api<{ baseId: string | null; included: number; excludedChanged: number }>(`/api/reciclaje-global/${id}/generar`, { method: "POST" });
      setMessage(result.baseId ? `Base reciclada global generada con ${result.included} móviles; ${result.excludedChanged} cambiaron al revalidar.` : `No se creó una base vacía: ${result.excludedChanged} móviles cambiaron de condición.`);
      load(page);
    } catch (error) { setMessage(error instanceof Error ? error.message : "No se pudo generar la base global."); } finally { setRunning(null); }
  }
  async function openBase(baseId: string) {
    try {
      const loaded = await api<{ base: LoadedBase }>(`/api/bases/${baseId}`);
      onOpen(restoreBatch(loaded.base));
      setMessage("Base reciclada global recuperada. Puedes continuar con las herramientas existentes de exportación.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "No se pudo recuperar la base global."); }
  }
  async function openDetail(id: string) {
    try { setDetail(await api<GlobalExecutionDetail>(`/api/reciclaje-global/${id}?limit=25`)); } catch (error) { setMessage(error instanceof Error ? error.message : "No se pudieron consultar las decisiones."); }
  }
  return <section className="border border-slate-200 bg-white p-4"><div className="flex items-center justify-between gap-3"><div><p className="text-sm font-semibold text-slate-900">Ejecuciones globales</p><p className="mt-1 text-xs text-slate-500">Consulta snapshots inmutables y genera solo decisiones elegibles, tras revalidación en servidor.</p></div><span className="text-xs font-semibold text-slate-600">{total}</span></div>{message ? <p role="status" className="mt-3 text-xs text-slate-700">{message}</p> : null}<div className="mt-3 divide-y divide-slate-100 border-y border-slate-100">{items.map((item) => <div key={item.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between"><div className="text-xs text-slate-600"><p className="font-semibold text-slate-900">{new Date(item.createdAt).toLocaleDateString("es-ES")} · {item.status}</p><p className="mt-1">{item.files} archivos · {item.bases} bases · Elegibles {item.summary?.ELEGIBLE ?? 0} · Revisión {item.summary?.REVISION ?? 0}</p></div><div className="flex gap-3"><button type="button" onClick={() => void openDetail(item.id)} className="text-xs font-semibold text-[#174ea6]">Ver decisiones</button>{item.recycledBaseId ? <button type="button" onClick={() => void openBase(item.recycledBaseId!)} className="text-xs font-semibold text-[#174ea6]">Abrir base generada</button> : <button type="button" disabled={item.status !== "EVALUADA" || (item.summary?.ELEGIBLE ?? 0) === 0 || running === item.id} onClick={() => void generate(item.id)} className="text-xs font-semibold text-[#174ea6] disabled:text-slate-400">{running === item.id ? "Generando…" : "Generar base global"}</button>}</div></div>)}</div>{detail ? <div className="mt-3 border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700"><div className="flex justify-between gap-3"><p className="font-semibold text-slate-900">Decisiones · {detail.status} · reglas {detail.ruleVersion}</p><button type="button" onClick={() => setDetail(null)} className="font-semibold text-[#174ea6]">Cerrar</button></div><ul className="mt-2 max-h-44 space-y-1 overflow-auto">{detail.decisions.map((row) => <li key={`${row.mobileMasked}-${row.reason}`}>{row.mobileMasked} · {row.decision}: {row.reason}</li>)}</ul>{detail.nextCursor ? <p className="mt-2 text-slate-500">Mostrando las primeras 25 decisiones; la API mantiene paginación por cursor.</p> : null}</div> : null}{total > 10 ? <div className="mt-3 flex justify-end gap-3 text-xs"><button type="button" disabled={page === 0} onClick={() => load(page - 1)} className="font-semibold text-[#174ea6] disabled:text-slate-400">Anterior</button><button type="button" disabled={(page + 1) * 10 >= total} onClick={() => load(page + 1)} className="font-semibold text-[#174ea6] disabled:text-slate-400">Siguiente</button></div> : null}</section>;
}

export function RecyclingWorkspaceV2({ onCreate, onContinue, initialOriginalBaseId = "" }: { onCreate: (batch: WorkingBatch) => void; onContinue: () => void; initialOriginalBaseId?: string }) {
  const input = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const cancelImport = useRef(false);
  const preparation = useRef<{ operationId: string; fileIds: Map<string, string> } | null>(null);
  const [analysis, setAnalysis] = useState<RecyclingAnalysis | null>(null);
  const [selectedTipifications, setSelectedTipifications] = useState<Set<string>>(() => new Set(defaultRecyclableTipifications));
  const [query, setQuery] = useState("");
  const [exceptionFilter, setExceptionFilter] = useState<ExceptionFilter>("all");
  const [page, setPage] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [issues, setIssues] = useState<SourceIssue[]>([]);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [createdBatch, setCreatedBatch] = useState<WorkingBatch | null>(null);
  const [originalBaseId, setOriginalBaseId] = useState(initialOriginalBaseId);
  const [execution, setExecution] = useState<RecyclingResult | null>(null);
  const [preparedExecutionId, setPreparedExecutionId] = useState<string | null>(null);
  const [conciliation, setConciliation] = useState<ConciliationSummary | null>(null);
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [isConciliating, setIsConciliating] = useState(false);
  const deferredQuery = useDeferredValue(query.trim().toLocaleLowerCase("es-ES"));
  const importing = progress !== null && progress.processed < progress.total;

  async function load(files: readonly File[] | FileList | null) {
    const selectedFiles = Array.from(files ?? []);
    if (!selectedFiles.length || importing) return;
    cancelImport.current = false;
    preparation.current = null;
    setMessage(null);
    setIssues([]);
    setCreatedBatch(null);
    setExecution(null);
    setPreparedExecutionId(null);
    setConciliation(null);
    const rejected: SourceIssue[] = [];
    const workbooks: { fileName: string; zipName?: string; internalPath?: string; bytes: ArrayBuffer; fingerprint: string }[] = [];
    const fingerprints = new Set<string>();
    let duplicates = 0;
    try {
      const archive = await import("@/lib/recycling/archive-import");
      for (const file of selectedFiles) {
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
          parsed.push({ fileName: source.fileName, importId: archive.importIdFromFingerprint(source.fingerprint), zipName: source.zipName, internalPath: source.internalPath, sheetName, columns: (rows[0] ?? []).map(String), rows: rows.slice(1).map((row) => row.map(String)) });
          valid += 1;
        } catch (caught) {
          rejected.push({ fileName: source.internalPath ?? source.fileName, reason: caught instanceof Error ? caught.message : "Excel corrupto o no legible." });
        }
        completed += 1;
        setProgress({ processed: completed, total: workbooks.length, valid, failed: rejected.length, duplicates });
        await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
      }
      if (parsed.length) {
        const nextAnalysis = analyzeRecyclingFiles(parsed);
        setAnalysis(nextAnalysis);
        setSelectedTipifications(new Set(defaultRecyclableTipifications.filter((tipification) => Object.keys(nextAnalysis.tipifications).some((value) => normalizeRecyclingTipification(value) === tipification))));
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
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    void load(files);
  }

  const availableTipifications = useMemo(() => {
    if (!analysis) return [];
    return [...new Set(Object.keys(analysis.tipifications).map(normalizeRecyclingTipification).filter(Boolean))].sort((left, right) => left.localeCompare(right, "es-ES"));
  }, [analysis]);
  const candidateCount = useMemo(() => analysis?.winners.filter((record) => record.bucket !== "bloqueado" && selectedTipifications.has(normalizeRecyclingTipification(record.tipification))).length ?? 0, [analysis, selectedTipifications]);
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
    preparation.current = null;
    setExecution(null);
    setCreatedBatch(null);
    setPreparedExecutionId(null);
    setConciliation(null);
  }

  async function prepareConciliation() {
    if (!analysis || !originalBaseId || isEvaluating || isConciliating) return;
    if (!analysis.conciliationRows.length) {
      setMessage("El Excel no contiene filas CRM para conciliar. Revisa la hoja y la columna de móvil.");
      return;
    }
    setIsConciliating(true);
    setMessage(null);
    try {
      if (!preparation.current) {
        const fileIds = new Map<string, string>();
        for (const row of analysis.conciliationRows) if (!fileIds.has(row.fileKey)) fileIds.set(row.fileKey, row.importId ?? operationId());
        preparation.current = { operationId: operationId(), fileIds };
      }
      const plan = preparation.current;
      const criteria = { effectiveDate: new Date().toISOString().slice(0, 10), recyclableTipifications: [...selectedTipifications], minimumMonths: 4, minimumDate: "2019-02-01" };
      const started = await api<{ id: string; status: string }>("/api/reciclaje", { method: "POST", body: JSON.stringify({ operationId: plan.operationId, baseOriginalId: originalBaseId, criteria, files: [...plan.fileIds.entries()].map(([key, importId]) => ({ importId, name: key.split("|").at(-1) })) }) });
      const preview = await api<{ conciliation: ConciliationSummary }>(`/api/reciclaje/${started.id}/conciliar`, { method: "POST", body: JSON.stringify({ rows: analysis.conciliationRows.map((row) => ({ fileId: plan.fileIds.get(row.fileKey), fileName: row.fileName, sourceRow: row.sourceRow, mobile: row.mobile })) }) });
      setPreparedExecutionId(started.id);
      setConciliation(preview.conciliation);
      setMessage(preview.conciliation.uniqueFoundMobiles === 0
        ? "No se encontraron móviles coincidentes con la base original seleccionada. Revisa la base seleccionada o la columna móvil del CRM."
        : "Conciliación preparada en servidor. Revisa los indicadores antes de confirmar las gestiones.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo preparar la conciliación.");
    } finally {
      setIsConciliating(false);
    }
  }

  async function evaluateRecycling() {
    if (!analysis || !preparedExecutionId || !conciliation || isEvaluating || execution) return;
    setIsEvaluating(true);
    setMessage(null);
    try {
      const plan = preparation.current!;
      const evaluated = await (async () => {
        const rows = analysis.records.map((record) => {
          const key = `${record.zipName ?? ""}|${record.internalPath ?? ""}|${record.fileName}`;
          return { importId: plan.fileIds.get(key), sourceRow: record.originRow, mobile: record.mobile, managedAt: record.date || null, tipification: record.tipification || null, confirmedSale: record.confirmedSale, saleAmbiguous: record.saleAmbiguous, saleEvidence: record.saleEvidence ?? null, fileName: record.fileName, sheetName: record.sheetName, zipName: record.zipName ?? null, internalPath: record.internalPath ?? null };
        });
        for (let index = 0; index < rows.length; index += 100) await api(`/api/reciclaje/${preparedExecutionId}/gestiones`, { method: "POST", body: JSON.stringify({ rows: rows.slice(index, index + 100) }) });
        return api<RecyclingResult>(`/api/reciclaje/${preparedExecutionId}/finalizar`, { method: "POST" });
      })();
      setExecution(evaluated);
      setMessage((evaluated.summary?.ELEGIBLE ?? 0) > 0
        ? `Evaluación completada: ${evaluated.summary?.ELEGIBLE ?? 0} candidatos cumplen todas las reglas.`
        : (evaluated.summary?.evaluated ?? 0) === 0
          ? "La base seleccionada no contiene registros válidos guardados. Ábrela, ejecuta Limpieza y pulsa Reintentar antes de reciclarla."
          : "La evaluación no encontró candidatos elegibles. Las incidencias y decisiones quedan disponibles para revisión.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo evaluar el reciclaje.");
    } finally {
      setIsEvaluating(false);
    }
  }

  async function generateBatch() {
    if (!execution || isEvaluating || (execution.summary?.ELEGIBLE ?? 0) === 0) return;
    setIsEvaluating(true);
    setMessage(null);
    try {
      const confirmed = await api<{ baseId: string }>(`/api/reciclaje/${execution.id}/confirmar`, { method: "POST" });
      const loaded = await api<{ base: LoadedBase }>(`/api/bases/${confirmed.baseId}`);
      const batch = restoreBatch(loaded.base);
      setCreatedBatch(batch);
      onCreate(batch);
      setMessage(`Evaluación y guardado completados: ${batch.dataset.records.length} móviles elegibles. La base reciclada ya está vinculada de forma permanente al historial.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo generar la base reciclada.");
    } finally {
      setIsEvaluating(false);
    }
  }

  const fileInputs = <><input ref={input} className="sr-only" type="file" accept=".xlsx,.zip,application/zip,application/x-zip-compressed" multiple onChange={handleInput} /><input ref={folderInput} className="sr-only" type="file" accept=".xlsx" multiple {...({ webkitdirectory: "", directory: "", onChange: handleInput } satisfies DirectoryInputProps)} /></>;
  const importControls = <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-end"><OriginalBaseSelector value={originalBaseId} onChange={(baseId) => { setOriginalBaseId(baseId); preparation.current = null; setCreatedBatch(null); setExecution(null); setPreparedExecutionId(null); setConciliation(null); }} disabled={importing} /><button type="button" disabled={importing || !originalBaseId} onClick={() => input.current?.click()} className="min-h-10 rounded-md bg-[#174ea6] px-4 py-2.5 text-sm font-semibold text-white disabled:bg-slate-300">{importing ? "Procesando…" : "Seleccionar Excel o ZIP"}</button><button type="button" disabled={importing || !originalBaseId} onClick={() => folderInput.current?.click()} className="min-h-10 rounded-md border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 disabled:opacity-60">Carpeta de Excel</button></div>;
  const progressPanel = progress ? <section className="border border-blue-200 bg-blue-50 p-4 text-sm text-blue-950"><p className="font-semibold">Procesando {progress.processed} de {progress.total} Excel</p><p className="mt-1">Válidos: {progress.valid} · Fallidos: {progress.failed} · Duplicados omitidos: {progress.duplicates}</p><button type="button" onClick={() => { cancelImport.current = true; }} className="mt-3 font-semibold text-[#174ea6]">Cancelar importación</button></section> : null;
  const issuePanel = issues.length ? <details className="border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950"><summary className="cursor-pointer font-semibold">{issues.length} archivo{issues.length === 1 ? " con incidencia" : "s con incidencias"}</summary><ul className="mt-2 max-h-44 space-y-1 overflow-auto text-xs">{issues.map((issue, index) => <li key={`${issue.fileName}-${index}`}><span className="font-medium">{issue.fileName}</span>: {issue.reason}</li>)}</ul></details> : null;

  if (!analysis) {
    return <section className="space-y-5"><div className="border-b border-slate-200 pb-5"><p className="text-[10px] font-bold uppercase tracking-[.14em] text-[#174ea6]">Consolidación local</p><h2 className="mt-1 text-2xl font-semibold text-[#0f274f]">Reciclaje CRM</h2><p className="mt-2 max-w-3xl text-sm text-slate-600">Importa varios XLSX o ZIP con subcarpetas. Todo se procesa en este navegador y no se envía a Neon ni a una API.</p></div>{fileInputs}{importControls}<RecyclingHistory baseId={originalBaseId} /><GlobalRecyclingHistory onOpen={onCreate} /><p className="text-xs text-slate-500">Límites: 500 Excel, 30 MB por Excel, 250 MB por ZIP comprimido y 750 MB descomprimidos por ZIP. La carpeta es opcional y depende del navegador.</p>{progressPanel}{message ? <p role="status" className="text-sm text-slate-700">{message}</p> : null}{issuePanel}</section>;
  }

  const summary: [string, number][] = [["Filas CRM", conciliation?.totalRows ?? analysis.conciliationRows.length], ["Móviles únicos válidos", conciliation?.uniqueValidMobiles ?? 0], ["Coincidentes", conciliation?.uniqueFoundMobiles ?? 0], ["No encontrados", conciliation?.uniqueMissingMobiles ?? 0], ["Filas inválidas", conciliation?.invalidRows ?? 0], ["Filas repetidas", conciliation?.duplicateRows ?? 0], ["Gestiones múltiples", conciliation?.mobilesWithMultipleManagements ?? 0], ["Elegibles", execution?.summary?.ELEGIBLE ?? 0]];
  const evaluatedEligible = execution?.summary?.ELEGIBLE ?? 0;
  return <section className="space-y-5">
    <div className="flex flex-col gap-4 border-b border-slate-200 pb-5 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-[10px] font-bold uppercase tracking-[.14em] text-[#174ea6]">Revisión humana requerida</p><h2 className="mt-1 text-2xl font-semibold text-[#0f274f]">Reciclaje consolidado</h2><p className="mt-2 text-sm text-slate-600">La base reciclada contiene solo los seleccionados; el historial CRM se conserva separado y nunca se exporta.</p></div><button type="button" onClick={() => input.current?.click()} className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700">Importar otros archivos</button></div>
    {fileInputs}
    <dl className="grid grid-cols-2 border border-slate-200 bg-white sm:grid-cols-3 lg:grid-cols-6">{summary.map(([label, value]) => <div key={label} className="border-b border-r border-slate-100 px-3 py-2 last:border-r-0 lg:border-b-0"><dt className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{label}</dt><dd className="mt-1 text-lg font-semibold text-slate-900">{value}</dd></div>)}</dl>
    <section className="border border-slate-200 bg-white p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-sm font-semibold">Tipificaciones que deseo evaluar para reciclar</p><p className="mt-1 text-xs text-slate-500">Marcarlas incluye esas gestiones como criterio de recuperación; desmarcarlas las deja fuera de la evaluación. No autoriza contactos ni crea una base por sí solo.</p></div><p className="text-sm font-semibold text-[#174ea6]">{candidateCount} gestiones CRM locales seleccionadas; aún no son elegibles</p></div>
      <div className="mt-3 flex flex-wrap gap-2">{availableTipifications.map((type) => <label key={type} className={`cursor-pointer rounded-md border px-3 py-2 text-sm ${selectedTipifications.has(type) ? "border-blue-600 bg-blue-50 text-blue-900" : "border-slate-200 text-slate-700"}`}><input type="checkbox" checked={selectedTipifications.has(type)} onChange={() => changeSelection(type)} className="sr-only" />{type} <span className="ml-1 font-mono text-xs">{Object.entries(analysis.tipifications).filter(([value]) => normalizeRecyclingTipification(value) === type).reduce((total, [, count]) => total + count, 0)}</span></label>)}<button type="button" onClick={() => { setSelectedTipifications(new Set(availableTipifications)); setCreatedBatch(null); }} className="px-2 text-xs font-semibold text-[#174ea6]">Todas</button><button type="button" onClick={() => { setSelectedTipifications(new Set()); setCreatedBatch(null); }} className="px-2 text-xs font-semibold text-[#174ea6]">Ninguna</button></div>
      <div className="mt-4 flex flex-wrap gap-2"><button type="button" disabled={isConciliating || isEvaluating || !originalBaseId || Boolean(preparedExecutionId)} onClick={prepareConciliation} className="rounded-md bg-[#174ea6] px-4 py-2 text-sm font-semibold text-white disabled:bg-slate-300">{isConciliating ? "Conciliando…" : preparedExecutionId ? "Conciliación completada" : "1. Conciliar archivo CRM"}</button><button type="button" disabled={isConciliating || isEvaluating || !preparedExecutionId || (conciliation?.uniqueFoundMobiles ?? 0) === 0 || Boolean(execution)} onClick={evaluateRecycling} className="rounded-md border border-[#174ea6] px-4 py-2 text-sm font-semibold text-[#174ea6] disabled:border-slate-200 disabled:text-slate-400">{execution ? "Evaluación completada" : "2. Evaluar reciclaje"}</button><button type="button" disabled={isConciliating || isEvaluating || !execution || evaluatedEligible === 0 || Boolean(createdBatch)} onClick={generateBatch} className="rounded-md bg-emerald-700 px-4 py-2 text-sm font-semibold text-white disabled:bg-slate-300">3. Generar base reciclada</button></div>
      {(isConciliating || message) ? <p role="status" className={`mt-3 text-xs ${message ? "text-slate-700" : "text-[#174ea6]"}`}>{isConciliating ? "Conciliando archivos CRM con la base original seleccionada…" : message}</p> : null}
      {execution?.summary ? <dl className="mt-4 grid grid-cols-2 border border-slate-200 sm:grid-cols-3 lg:grid-cols-6">{[["Elegibles", execution.summary.ELEGIBLE ?? 0], ["Ventas bloqueadas", execution.summary.BLOQUEADO_VENTA ?? 0], ["Tipificación / gestión", execution.summary.REVISION_GESTION ?? 0], ["Permanencia", execution.summary.REVISION_PERMANENCIA ?? 0], ["Reservas / conflictos", execution.summary.REVISION_CONFLICTO ?? 0], ["Fuera de rango", execution.summary.FUERA_RANGO_HISTORICO ?? 0]].map(([label, value]) => <div key={String(label)} className="border-b border-r border-slate-100 px-3 py-2 lg:border-b-0"><dt className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{label}</dt><dd className="mt-1 text-base font-semibold text-slate-900">{value}</dd></div>)}</dl> : null}
      {execution && evaluatedEligible === 0 ? <p role="status" className="mt-3 text-xs text-amber-800">{(execution.summary?.evaluated ?? 0) === 0 ? "No se evaluaron coincidencias de la base original. Revisa la conciliación y las incidencias antes de generar una base reciclada." : "No hay candidatos elegibles después de validar ventas, reservas, tipificación y permanencia. La base no se puede generar; consulta las decisiones e incidencias."}</p> : null}
    </section>
    {createdBatch ? <section role="status" className="flex flex-col gap-3 border border-emerald-200 bg-emerald-50 p-4 sm:flex-row sm:items-center sm:justify-between"><p className="text-sm text-emerald-900"><span className="font-semibold">Base reciclada creada:</span> {createdBatch.dataset.records.length} registros operativos · <span className="font-mono">{createdBatch.id.slice(0, 8)}</span>.</p><button type="button" onClick={onContinue} className="rounded-md bg-[#174ea6] px-4 py-2 text-sm font-semibold text-white">Continuar a campañas</button></section> : null}
    <section className="border border-slate-200 bg-white p-4"><div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-sm font-semibold">Incidencias locales del archivo CRM</p><p className="mt-1 text-xs text-slate-500">Un estado «candidato» aquí solo refleja su tipificación local; no equivale a elegible hasta conciliar y evaluar en servidor.</p></div><div className="flex gap-2"><input value={query} onChange={(event) => { setQuery(event.target.value); setPage(0); }} placeholder="Buscar" className="min-h-9 rounded-md border border-slate-300 px-2 text-sm" /><select value={exceptionFilter} onChange={(event) => { setExceptionFilter(event.target.value as ExceptionFilter); setPage(0); }} className="min-h-9 rounded-md border border-slate-300 bg-white px-2 text-sm"><option value="all">Todas</option><option value="revision">Revisión</option><option value="bloqueado">Bloqueados</option></select></div></div><div className="mt-4"><DataTable caption="Incidencias locales del reciclaje" columns={["Estado", "Tipificación", "Archivo", "Hoja", "Fila", "Motivo"]} rows={exceptionRows.map((record) => ({ id: String(record.sourceRow), cells: [record.bucket, record.tipification || "Sin tipificación", record.fileName, record.sheetName, String(record.originRow), record.reviewReason ?? "Pendiente de revisión"] }))} emptyMessage="No hay incidencias con los filtros actuales." /></div>{exceptions.length > exceptionPageSize ? <div className="mt-3 flex items-center justify-end gap-3 text-sm"><button type="button" disabled={page === 0} onClick={() => setPage((current) => current - 1)} className="font-semibold text-[#174ea6] disabled:text-slate-400">Anterior</button><span>{page + 1} / {exceptionPages}</span><button type="button" disabled={page >= exceptionPages - 1} onClick={() => setPage((current) => current + 1)} className="font-semibold text-[#174ea6] disabled:text-slate-400">Siguiente</button></div> : null}</section>
  </section>;
}
