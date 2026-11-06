"use client";
import type { ChangeEvent } from "react";
import { useMemo, useRef, useState } from "react";
import {
  defaultRecyclableTipifications,
  normalizeRecyclingTipification,
} from "@/lib/recycling/intelligent-recycling";
import {
  defaultRecyclingImportLimits,
  extractArchiveWorkbooks,
  fingerprintBytes,
  importIdFromFingerprint,
} from "@/lib/recycling/archive-import";
import {
  analyzeRecyclingFiles,
} from "@/lib/recycling/recycling";
import {
  restoreBatch,
  type LoadedBase,
} from "@/lib/persistence/workspace-persistence";
import type { WorkingBatch } from "@/lib/workspace/batch";
type Parsed = {
  fileName: string;
  importId: string;
  fingerprint: string;
  sheet: string;
  headers: string[];
  rows: string[][];
  zipName?: string;
  internalPath?: string;
};
type Summary = {
  logicalMobiles: number;
  found: number;
  unmatched: number;
  contradictions: number;
};
type Preview = { resumen: { filasInvalidas: number } };
type Execution = {
  id: string;
  status: string;
  summary: Record<string, number> | null;
  recycledBaseId: string | null;
};
type Reason = { decision: string; reason: string; count: number };
type FileIssue = { fileName: string; reason: string };
type FileProgress = "LISTO" | "REGISTRANDO" | "REGISTRADO" | "CONCILIANDO" | "CONCILIADO" | "ERROR";
async function api<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const r = await fetch(input, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!r.ok)
    throw new Error(
      ((await r.json().catch(() => null)) as { error?: string } | null)
        ?.error ?? "No se pudo completar el reciclaje global.",
    );
  return r.json() as Promise<T>;
}
const norm = (v: string) =>
  v
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es-ES")
    .replace(/[^a-z0-9]/g, "");
const col = (h: string[], n: string[]) =>
  h.findIndex((x) => n.includes(norm(x)));
function Step({
  number,
  title,
  detail,
  done,
  children,
}: {
  number: number;
  title: string;
  detail: string;
  done?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section
      className={`border p-5 ${done ? "border-emerald-200 bg-emerald-50/40" : "border-slate-200 bg-white"}`}
    >
      <div className="flex gap-4">
        <span
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white ${done ? "bg-emerald-700" : "bg-[#174ea6]"}`}
        >
          {done ? "✓" : number}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-semibold text-[#0f274f]">{title}</h3>
          <p className="mt-1 max-w-3xl text-sm text-slate-600">{detail}</p>
          <div className="mt-4">{children}</div>
        </div>
      </div>
    </section>
  );
}
export function GlobalRecyclingWorkspace({
  onOpen,
}: {
  onOpen: (b: WorkingBatch) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [parsed, setParsed] = useState<Parsed[]>([]),
    [fileIds, setFileIds] = useState<string[]>([]),
    [fileProgress, setFileProgress] = useState<Record<string, FileProgress>>({}),
    [issues, setIssues] = useState<FileIssue[]>([]),
    [duplicateFiles, setDuplicateFiles] = useState(0),
    [summary, setSummary] = useState<Summary | null>(null),
    [preview, setPreview] = useState<Preview | null>(null),
    [selected, setSelected] = useState<Set<string>>(
      () => new Set(defaultRecyclableTipifications),
    ),
    [execution, setExecution] = useState<Execution | null>(null),
    [reasons, setReasons] = useState<Reason[]>([]),
    [busy, setBusy] = useState<string | null>(null),
    [message, setMessage] = useState<string | null>(null);
  const sourceAnalysis = useMemo(
    () =>
      analyzeRecyclingFiles(
        parsed.map((file) => ({
          fileName: file.fileName,
          importId: file.importId,
          zipName: file.zipName,
          internalPath: file.internalPath,
          sheetName: file.sheet,
          columns: file.headers,
          rows: file.rows,
        })),
      ),
    [parsed],
  );
  const mobileColumn = (file: Parsed) =>
    col(file.headers, [
            "telefonomovil",
            "telefonosmovil",
            "movil",
            "celular",
            "nums",
            "numeroemitido",
          ]);
  const fieldColumns = (file: Parsed) => ({
    mobile: mobileColumn(file),
    tip: col(file.headers, ["tipificacion", "resultado"]),
    date: col(file.headers, ["fecha", "fechagestion", "fechainstalacion"]),
    sale: col(file.headers, ["ventaconfirmada", "venta", "estadoventa", "estadocomercial"]),
  });
  const tips = useMemo<string[]>(
    () =>
      [...new Set(sourceAnalysis.records.map((record) => normalizeRecyclingTipification(record.tipification)).filter(Boolean))].sort(),
    [sourceAnalysis],
  );
  const found = summary ? summary.logicalMobiles - summary.unmatched : 0;
  const toggle = (t: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(t)) n.delete(t);
      else n.add(t);
      return n;
    });
  async function select(e: ChangeEvent<HTMLInputElement>) {
    const sources = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (!sources.length) return;
    setBusy("Leyendo archivos CRM…");
    setMessage(null);
    setFileIds([]);
    setFileProgress({});
    setIssues([]);
    setDuplicateFiles(0);
    setSummary(null);
    setPreview(null);
    setExecution(null);
    setReasons([]);
    try {
      const workbooks: { fileName: string; zipName?: string; internalPath?: string; bytes: ArrayBuffer; fingerprint: string }[] = [];
      const rejected: FileIssue[] = [];
      const fingerprints = new Set<string>();
      let duplicates = 0;
      for (const source of sources) {
        if (/\.zip$/i.test(source.name)) {
          const extracted = await extractArchiveWorkbooks(source.name, await source.arrayBuffer());
          rejected.push(...extracted.rejected);
          for (const extractedFile of extracted.workbooks) {
            if (fingerprints.has(extractedFile.fingerprint)) duplicates += 1;
            else { fingerprints.add(extractedFile.fingerprint); workbooks.push(extractedFile); }
          }
          continue;
        }
        if (!/\.(xlsx|csv)$/i.test(source.name)) { rejected.push({ fileName: source.name, reason: "Formato no admitido; se aceptan XLSX, CSV y ZIP." }); continue; }
        if (source.size > defaultRecyclingImportLimits.maxWorkbookBytes) { rejected.push({ fileName: source.name, reason: "El archivo supera el límite de 30 MB por archivo." }); continue; }
        const bytes = await source.arrayBuffer(), fingerprint = await fingerprintBytes(bytes);
        if (fingerprints.has(fingerprint)) duplicates += 1;
        else { fingerprints.add(fingerprint); workbooks.push({ fileName: source.name, bytes, fingerprint }); }
      }
      if (workbooks.length > defaultRecyclingImportLimits.maxFiles) {
        rejected.push({ fileName: "Selección", reason: "Se alcanzó el límite de 500 archivos por operación." });
      }
      const X = (await import("xlsx")).default ?? (await import("xlsx"));
      const loaded: Parsed[] = [];
      for (const source of workbooks.slice(0, defaultRecyclingImportLimits.maxFiles)) {
        try {
          const workbook = X.read(source.bytes, { cellText: true });
          const sheet = workbook.SheetNames.find((name) => name.toLocaleLowerCase("es-ES") === "datos") ?? workbook.SheetNames[0];
          if (!sheet || !workbook.Sheets[sheet]) throw new Error("No contiene una hoja legible.");
          const values = X.utils.sheet_to_json<string[]>(workbook.Sheets[sheet], { header: 1, raw: false, defval: "" });
          const headers = (values[0] ?? []).map(String);
          if (!headers.some((value) => value.trim())) throw new Error("No contiene encabezados legibles.");
          const item = { fileName: source.fileName, importId: importIdFromFingerprint(source.fingerprint), fingerprint: source.fingerprint, sheet, headers, rows: values.slice(1).map((row) => row.map(String)), zipName: source.zipName, internalPath: source.internalPath };
          if (mobileColumn(item) < 0) throw new Error("No se identificó una columna de móvil confiable.");
          loaded.push(item);
        } catch (error) { rejected.push({ fileName: source.internalPath ?? source.fileName, reason: error instanceof Error ? error.message : "Archivo corrupto o no legible." }); }
      }
      setParsed(loaded);
      setIssues(rejected);
      setDuplicateFiles(duplicates);
      setSelected(new Set(defaultRecyclableTipifications));
      if (!loaded.length) setMessage("No hay archivos CRM válidos para registrar.");
      else if (rejected.length) setMessage("Hay archivos rechazados. Corrígelos o selecciónalos de nuevo antes de una conciliación completa.");
      else setMessage(`${loaded.length} archivo${loaded.length === 1 ? "" : "s"} preparado${loaded.length === 1 ? "" : "s"}; todavía no se ha realizado ninguna conciliación.`);
    } catch (x) {
      setMessage(x instanceof Error ? x.message : "No se pudo leer el Excel.");
    } finally {
      setBusy(null);
    }
  }
  async function register() {
    if (!parsed.length || issues.length) return;
    setBusy("Registrando archivos canónicos…");
    let registering: Parsed | null = null;
    try {
      const ids: string[] = [];
      for (const item of parsed) {
        registering = item;
        setFileProgress((current) => ({ ...current, [item.importId]: "REGISTRANDO" }));
        const file = await api<{ id: string }>("/api/reciclaje-global/archivos", { method: "POST", body: JSON.stringify({ importacionId: item.importId, huellaContenido: item.fingerprint, nombreArchivo: item.fileName, headers: item.headers, procedencia: { zipName: item.zipName ?? null, internalPath: item.internalPath ?? null } }) });
        const columns = fieldColumns(item);
        for (let i = 0; i < item.rows.length; i += 100) {
          const rows = item.rows.slice(i, i + 100).map((cells, offset) => {
            const value = columns.sale >= 0 ? (cells[columns.sale] ?? "").trim().toLocaleUpperCase("es-ES") : "";
            const confirmed = ["SI", "SÍ", "TRUE", "CONFIRMADA", "CONFIRMADO"].includes(value);
            return { hoja: item.sheet, fila: i + offset + 2, movil: cells[columns.mobile] ?? "", fechaGestion: columns.date >= 0 ? (cells[columns.date] ?? "") || null : null, tipificacion: columns.tip >= 0 ? (cells[columns.tip] ?? "") || null : null, ventaConfirmada: confirmed, evidenciaVenta: confirmed ? "Venta confirmada indicada por el archivo CRM." : null, cells };
          });
          await api(`/api/reciclaje-global/archivos/${file.id}/filas`, { method: "POST", body: JSON.stringify({ rows }) });
        }
        ids.push(file.id);
        setFileProgress((current) => ({ ...current, [item.importId]: "REGISTRADO" }));
      }
      setFileIds(ids);
      setMessage("Todos los archivos se registraron. Aún no se ha evaluado ni generado ninguna base.");
    } catch (x) {
      setFileProgress((current) => Object.fromEntries(Object.entries(current).map(([key, value]) => [key, value === "REGISTRANDO" ? "ERROR" : value])));
      const detail = x instanceof Error ? x.message : "No se pudo completar el registro.";
      setMessage(
        registering
          ? `No se pudo registrar ${registering.fileName}: ${detail}`
          : detail,
      );
    } finally {
      setBusy(null);
    }
  }
  async function conciliate() {
    if (!fileIds.length || fileIds.length !== parsed.length) return;
    setBusy("Comparando los archivos con las bases originales activas…");
    setSummary(null);
    setPreview(null);
    setExecution(null);
    setReasons([]);
    try {
      const results: { summary: Summary; preview: Preview }[] = [];
      for (const [index, id] of fileIds.entries()) {
        const item = parsed[index];
        if (!item) continue;
        setFileProgress((current) => ({ ...current, [item.importId]: "CONCILIANDO" }));
        const result = await api<{ summary: Summary; preview: Preview }>(`/api/reciclaje-global/archivos/${id}/conciliar`, { method: "POST" });
        results.push(result);
        setFileProgress((current) => ({ ...current, [item.importId]: "CONCILIADO" }));
      }
      // Per-file conciliation persists every association. The displayed total
      // is logical and deduplicated; detailed provenance stays server-side.
      const singleSource = results.length === 1 ? results[0]?.summary : null;
      const unmatched = Math.min(sourceAnalysis.counts.moviles, results.reduce((total, result) => total + result.summary.unmatched, 0));
      const contradictions = Math.min(sourceAnalysis.counts.moviles, results.reduce((total, result) => total + result.summary.contradictions, 0));
      setSummary(singleSource ?? { logicalMobiles: sourceAnalysis.counts.moviles, found: sourceAnalysis.counts.moviles - unmatched, unmatched, contradictions });
      setPreview({ resumen: { filasInvalidas: results.reduce((total, result) => total + result.preview.resumen.filasInvalidas, 0) } });
      setMessage(
        (singleSource?.found ?? sourceAnalysis.counts.moviles - unmatched) > 0
          ? "Comprobación completada."
          : "No se encontraron móviles coincidentes en las bases originales activas.",
      );
    } catch (x) {
      setMessage(
        x instanceof Error ? x.message : "No se pudo comprobar el archivo CRM.",
      );
    } finally {
      setBusy(null);
    }
  }
  async function prepare() {
    if (!fileIds.length || !selected.size) {
      setMessage(
        "Selecciona al menos una tipificación para incluirla en la evaluación.",
      );
      return;
    }
    setBusy("Preparando los números para evaluar…");
    try {
      const r = await api<{ id: string; status: string }>(
        "/api/reciclaje-global",
        {
          method: "POST",
          body: JSON.stringify({
            operationId: crypto.randomUUID(),
            archivoCrmIds: fileIds,
            criteria: {
              effectiveDate: new Date().toISOString().slice(0, 10),
              recyclableTipifications: [...selected],
              minimumMonths: 4,
              minimumDate: "2019-02-01",
            },
          }),
        },
      );
      setExecution({
        id: r.id,
        status: r.status,
        summary: null,
        recycledBaseId: null,
      });
    } catch (x) {
      setMessage(
        x instanceof Error
          ? x.message
          : "No se pudo preparar la ejecución global.",
      );
    } finally {
      setBusy(null);
    }
  }
  async function evaluate() {
    if (!execution) return;
    setBusy("Evaluando reglas comerciales…");
    try {
      const r = await api<{ status: string; summary: Record<string, number> }>(
        `/api/reciclaje-global/${execution.id}/evaluar`,
        { method: "POST" },
      );
      setExecution((c) =>
        c ? { ...c, status: r.status, summary: r.summary } : c,
      );
      const d = await api<{ reasonSummary: Reason[] }>(
        `/api/reciclaje-global/${execution.id}?limit=1`,
      );
      setReasons(d.reasonSummary);
      setMessage(
        (r.summary.ELEGIBLE ?? 0)
          ? "Evaluación completada."
          : "No hay elegibles. Revisa los motivos agregados.",
      );
    } catch (x) {
      setMessage(x instanceof Error ? x.message : "No se pudo evaluar.");
    } finally {
      setBusy(null);
    }
  }
  async function generate() {
    if (!execution) return;
    setBusy("Revalidando y generando…");
    try {
      const r = await api<{
        baseId: string | null;
        included: number;
        excludedChanged: number;
      }>(`/api/reciclaje-global/${execution.id}/generar`, { method: "POST" });
      setExecution((c) => (c ? { ...c, recycledBaseId: r.baseId } : c));
      setMessage(
        r.baseId
          ? `Base global creada con ${r.included} móviles. ${r.excludedChanged} cambiaron de condición al confirmar.`
          : `No se generó una base vacía; ${r.excludedChanged} móviles cambiaron de condición.`,
      );
    } catch (x) {
      setMessage(
        x instanceof Error ? x.message : "No se pudo generar la base global.",
      );
    } finally {
      setBusy(null);
    }
  }
  async function open() {
    if (!execution?.recycledBaseId) return;
    try {
      const r = await api<{ base: LoadedBase }>(
        `/api/bases/${execution.recycledBaseId}`,
      );
      onOpen(restoreBatch(r.base));
      setMessage(
        "Base global recuperada. La exportación CRM conserva sus 24 encabezados.",
      );
    } catch (x) {
      setMessage(
        x instanceof Error ? x.message : "No se pudo abrir la base generada.",
      );
    }
  }
  const metrics =
    summary && preview
      ? [
          ["Móviles", summary.logicalMobiles],
          ["Encontrados", summary.found],
          ["No encontrados", summary.unmatched],
          ["Contradicciones", summary.contradictions],
          ["Inválidos", preview.resumen.filasInvalidas],
        ]
      : [];
  return (
    <section className="space-y-4" aria-labelledby="global-recycling-title">
      <header className="border-b border-slate-200 pb-5">
        <h2
          id="global-recycling-title"
          className="text-2xl font-semibold tracking-tight text-[#0f274f]"
        >
          Reciclaje global
        </h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
          Compara un archivo CRM con todas las bases originales activas. La
          coincidencia técnica no crea elegibilidad, reservas ni distribución
          comercial.
        </p>
      </header>
      <input
        ref={input}
        className="sr-only"
        type="file"
        accept=".xlsx,.csv,.zip,application/zip,application/x-zip-compressed,text/csv"
        multiple
        onChange={select}
      />
      <Step
        number={1}
        title="Cargar archivos CRM"
        detail="Selecciona uno o varios XLSX/CSV o un ZIP estándar. Cada archivo se registra de forma canónica antes de compararlo."
      >
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => input.current?.click()}
            disabled={!!busy}
            className="min-h-10 rounded-md bg-[#174ea6] px-4 text-sm font-semibold text-white disabled:bg-slate-300"
          >
            Seleccionar archivos CRM
          </button>
          <button
            type="button"
            onClick={() => void register()}
            disabled={!parsed.length || !!issues.length || !!busy || !!fileIds.length}
            className="min-h-10 rounded-md border border-[#174ea6] px-4 text-sm font-semibold text-[#174ea6] disabled:border-slate-200 disabled:text-slate-400"
          >
            Registrar archivos
          </button>
          {parsed.length ? (
            <span className="text-xs text-slate-600">
              {parsed.length} archivos · {parsed.reduce((total, item) => total + item.rows.length, 0)} filas · {sourceAnalysis.counts.moviles} móviles únicos
              {duplicateFiles ? ` · ${duplicateFiles} archivo${duplicateFiles === 1 ? "" : "s"} repetido${duplicateFiles === 1 ? "" : "s"} omitido${duplicateFiles === 1 ? "" : "s"}` : ""}
            </span>
          ) : null}
        </div>
        {parsed.length ? <ul className="mt-4 divide-y divide-slate-100 border-y border-slate-200 text-xs text-slate-700">{parsed.map((item) => <li key={item.importId} className="flex flex-wrap items-center justify-between gap-2 py-2"><span>{item.zipName ? `${item.zipName} · ${item.internalPath ?? item.fileName}` : item.fileName} · {item.rows.length} filas</span><b className="text-slate-600">{fileProgress[item.importId] ?? "LISTO"}</b></li>)}</ul> : null}
        {issues.length ? <ul className="mt-4 space-y-1 border-l-2 border-amber-500 bg-amber-50 p-3 text-xs text-amber-900">{issues.map((issue, index) => <li key={`${issue.fileName}-${index}`}><b>{issue.fileName}:</b> {issue.reason}</li>)}</ul> : null}
      </Step>
      <Step
        number={2}
        title="Comprobar coincidencias"
        detail="Identifica procedencias; todavía no decide quién puede reciclarse."
        done={!!summary}
      >
        <button
          type="button"
          onClick={() => void conciliate()}
          disabled={!fileIds.length || fileIds.length !== parsed.length || !!issues.length || !!busy}
          className="min-h-10 rounded-md border border-[#174ea6] px-4 text-sm font-semibold text-[#174ea6] disabled:border-slate-200 disabled:text-slate-400"
        >
          {summary ? "Actualizar coincidencias" : "Comprobar contra bases activas"}
        </button>
        {metrics.length ? (
          <dl className="mt-4 grid grid-cols-2 divide-x divide-y divide-slate-200 border border-slate-200 sm:grid-cols-5">
            {metrics.map(([l, v]) => (
              <div key={String(l)} className="p-3">
                <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  {l}
                </dt>
                <dd className="mt-1 text-xl font-semibold tabular-nums text-slate-900">
                  {v}
                </dd>
              </div>
            ))}
          </dl>
        ) : null}
      </Step>
      <Step
        number={3}
        title="Evaluar para reciclaje"
        detail="Las tipificaciones son criterios; la evaluación aplica controles comerciales en servidor."
        done={execution?.status === "EVALUADA"}
      >
        <div className="flex flex-wrap gap-2">
          {tips.map((t) => (
            <label
              key={t}
              className={`cursor-pointer rounded-md border px-3 py-2 text-sm ${selected.has(t) ? "border-[#174ea6] bg-blue-50 text-[#0f274f]" : "border-slate-200 text-slate-700"}`}
            >
              <input
                type="checkbox"
                checked={selected.has(t)}
                onChange={() => toggle(t)}
                className="mr-2 accent-[#174ea6]"
              />
              {t}
            </label>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => void prepare()}
            disabled={!found || !!busy || !!execution || !!issues.length}
            className="min-h-10 rounded-md bg-[#174ea6] px-4 text-sm font-semibold text-white disabled:bg-slate-300"
          >
            Preparar evaluación
          </button>
          <button
            type="button"
            onClick={() => void evaluate()}
            disabled={!execution || execution.status !== "PREPARADA" || !!busy}
            className="min-h-10 rounded-md border border-[#174ea6] px-4 text-sm font-semibold text-[#174ea6] disabled:border-slate-200 disabled:text-slate-400"
          >
            Evaluar para reciclaje
          </button>
        </div>
        {execution?.summary ? (
          <>
            <dl className="mt-4 grid grid-cols-2 divide-x divide-y divide-slate-200 border border-slate-200 sm:grid-cols-4">
              {[
                ["Cumplen los criterios", execution.summary.ELEGIBLE ?? 0],
                ["Requieren revisión", execution.summary.REVISION ?? 0],
                ["Excluidos", execution.summary.EXCLUIDO ?? 0],
                ["No pueden reciclarse", execution.summary.BLOQUEADO ?? 0],
              ].map(([l, v]) => (
                <div key={String(l)} className="p-3">
                  <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    {l}
                  </dt>
                  <dd className="mt-1 text-xl font-semibold tabular-nums text-slate-900">
                    {v}
                  </dd>
                </div>
              ))}
            </dl>
            {reasons.length ? (
              <details className="mt-4 border-t border-slate-200 pt-3 text-sm text-slate-700">
                <summary className="cursor-pointer font-semibold text-[#0f274f]">
                  Ver motivos agregados de decisión
                </summary>
                <ul className="mt-3 space-y-1 text-xs">
                  {reasons.map((x) => (
                    <li key={`${x.decision}-${x.reason}`}>
                      <b>{x.count}</b> · {x.decision}: {x.reason}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </>
        ) : null}
      </Step>
      <Step
        number={4}
        title="Generar y descargar"
        detail="Se vuelven a validar ventas y reservas antes de crear la base."
        done={!!execution?.recycledBaseId}
      >
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void generate()}
            disabled={
              !execution ||
              execution.status !== "EVALUADA" ||
              !(execution.summary?.ELEGIBLE ?? 0) ||
              !!execution.recycledBaseId ||
              !!busy
            }
            className="min-h-10 rounded-md bg-emerald-700 px-4 text-sm font-semibold text-white disabled:bg-slate-300"
          >
            Generar base reciclada
          </button>
          {execution?.recycledBaseId ? (
            <>
              <button
                type="button"
                onClick={() => void open()}
                className="min-h-10 text-sm font-semibold text-[#174ea6]"
              >
                Abrir base generada
              </button>
              <a
                href={`/api/reciclaje-global/${execution.id}/descargar`}
                className="py-2 text-sm font-semibold text-[#174ea6]"
              >
                Descargar XLSX CRM
              </a>
            </>
          ) : execution?.summary && !(execution.summary.ELEGIBLE ?? 0) ? (
            <span className="text-xs text-amber-800">
              No es posible generar una base sin móviles elegibles.
            </span>
          ) : null}
        </div>
      </Step>
      {busy || message ? (
        <p
          role="status"
          className="border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700"
        >
          {busy ?? message}
        </p>
      ) : null}
    </section>
  );
}
