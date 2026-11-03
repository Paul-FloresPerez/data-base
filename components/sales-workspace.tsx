"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { detectSalesMobileColumn, previewSalesImport, suggestSalesColumnMapping, type SalesColumnMapping, type SalesImportMode } from "@/lib/sales/sales-import";

type SheetData = { name: string; headers: string[]; rows: { sourceRow: number; cells: string[] }[] };
type ImportHistory = { id: string; nombreArchivo: string; creadoEn: string; resumen: { validUnique?: number; alreadyBlocked?: number } };

async function fingerprint(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function SalesWorkspace() {
  const input = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [period, setPeriod] = useState("");
  const [sheet, setSheet] = useState<SheetData | null>(null);
  const [mapping, setMapping] = useState<Partial<SalesColumnMapping>>({});
  const [advanced, setAdvanced] = useState(false);
  const [previouslyBlocked, setPreviouslyBlocked] = useState<number | null>(null);
  const [history, setHistory] = useState<ImportHistory[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const mode: SalesImportMode = advanced ? "AVANZADA" : "BASICA";
  const detection = useMemo(() => sheet ? detectSalesMobileColumn(sheet.headers) : null, [sheet]);
  const preview = useMemo(() => sheet && mapping.mobile !== undefined ? previewSalesImport(sheet.rows, mapping as SalesColumnMapping, mode) : null, [mapping, mode, sheet]);
  const validMobiles = useMemo(() => preview?.events.flatMap((event) => event.reason === "VALIDA" && event.mobile ? [event.mobile] : []) ?? [], [preview]);

  async function loadHistory() {
    try {
      const response = await fetch("/api/ventas");
      if (!response.ok) return;
      const data = await response.json() as { imports?: ImportHistory[] };
      setHistory(data.imports ?? []);
    } catch {
      // Listing failure must never prevent a new import from being prepared.
    }
  }

  useEffect(() => { void loadHistory(); }, []);

  useEffect(() => {
    let current = true;
    if (!validMobiles.length) { setPreviouslyBlocked(0); return () => { current = false; }; }
    setPreviouslyBlocked(null);
    void fetch("/api/ventas/previsualizar", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mobiles: validMobiles }),
    }).then(async (response) => response.ok ? response.json() as Promise<{ previouslyBlocked: number }> : Promise.reject())
      .then((result) => { if (current) setPreviouslyBlocked(result.previouslyBlocked); })
      .catch(() => { if (current) setPreviouslyBlocked(null); });
    return () => { current = false; };
  }, [validMobiles]);

  async function load(file: File) {
    setMessage(null); setPreviouslyBlocked(null); setSheet(null);
    if (!/\.xlsx$/i.test(file.name) || file.size > 25 * 1024 * 1024) { setMessage("Selecciona un XLSX de hasta 25 MB."); return; }
    try {
      const [xlsx, buffer] = await Promise.all([import("xlsx"), file.arrayBuffer()]);
      const workbook = xlsx.read(buffer, { type: "array" });
      const first = workbook.SheetNames[0];
      if (!first || !workbook.Sheets[first]) throw new Error("Sin hojas");
      const values = xlsx.utils.sheet_to_json<unknown[]>(workbook.Sheets[first], { header: 1, raw: false, defval: "", blankrows: true });
      const headers = (values[0] ?? []).map((value) => String(value));
      if (!headers.length) throw new Error("Sin encabezados");
      setFileName(file.name);
      setSheet({ name: first, headers, rows: values.slice(1).map((row, index) => ({ sourceRow: index + 2, cells: headers.map((_, column) => String(row[column] ?? "")) })) });
      setMapping(suggestSalesColumnMapping(headers));
      setAdvanced(false);
    } catch { setMessage("No se pudo leer el Excel de ventas."); }
  }

  async function confirm() {
    if (!preview || !sheet || !preview.summary.validUnique || isSubmitting) return;
    setMessage(null); setIsSubmitting(true);
    const importId = crypto.randomUUID();
    try {
      const sourceFingerprint = await fingerprint(JSON.stringify({ fileName, mode, period: advanced ? period : null, headers: sheet.headers, events: preview.events }));
      const response = await fetch("/api/ventas", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ importId, fileName, declaredPeriod: advanced && period ? period : null, sourceFingerprint, mode, events: preview.events }) });
      if (!response.ok) throw new Error();
      const result = await response.json() as { reused?: boolean };
      setMessage(result.reused ? "Este archivo ya estaba registrado; se conservó su historial sin duplicar bloqueos." : "Ventas registradas. Los móviles válidos quedan bloqueados globalmente sin vencimiento automático.");
      await loadHistory();
    } catch { setMessage("No se pudo registrar la importación. No se han mostrado datos personales."); }
    finally { setIsSubmitting(false); }
  }

  const select = (label: string, value: keyof SalesColumnMapping) => <label className="text-xs font-semibold text-slate-700">{label}<select value={mapping[value] ?? ""} onChange={(event) => setMapping((current) => ({ ...current, [value]: event.target.value === "" ? undefined : Number(event.target.value) }))} className="mt-1 block min-h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm font-normal"><option value="">No usar</option>{sheet?.headers.map((header, index) => <option key={`${header}-${index}`} value={index}>{header || `Columna ${index + 1}`}</option>)}</select></label>;

  return <section className="space-y-5"><div className="border-b border-slate-200 pb-5"><p className="text-[10px] font-bold uppercase tracking-[.14em] text-[#174ea6]">Control comercial</p><h2 className="mt-1 text-2xl font-semibold text-[#0f274f]">Ventas</h2><p className="mt-2 max-w-3xl text-sm text-slate-600">Carga un Excel de móviles vendidos. Cada móvil válido se bloquea globalmente y sin caducidad automática.</p></div><input ref={input} type="file" accept=".xlsx" className="sr-only" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void load(file); }} /><button type="button" onClick={() => input.current?.click()} className="rounded-md bg-[#174ea6] px-4 py-2 text-sm font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#174ea6]">Seleccionar Excel de ventas</button>{sheet ? <><section className="border border-slate-200 bg-white p-4"><p className="text-sm font-semibold">Archivo seleccionado · {fileName}</p><p className="mt-1 text-xs text-slate-500">Hoja {sheet.name}. Este archivo no crea contactos ni modifica bases originales.</p>{mapping.mobile !== undefined ? <p className="mt-3 text-sm text-emerald-800">Móvil detectado: <strong>{sheet.headers[mapping.mobile] || `Columna ${mapping.mobile + 1}`}</strong>.</p> : <label className="mt-3 block max-w-md text-xs font-semibold text-slate-700">{detection?.ambiguous ? "Hay varias columnas de móvil posibles. Elige una para continuar." : "No se detectó una columna móvil confiable. Elige una para continuar."}<select value="" onChange={(event) => setMapping((current) => ({ ...current, mobile: Number(event.target.value) }))} className="mt-1 block min-h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm font-normal"><option value="" disabled>Seleccionar columna móvil</option>{sheet.headers.map((header, index) => <option key={`${header}-${index}`} value={index}>{header || `Columna ${index + 1}`}</option>)}</select></label>}<details className="mt-4 border-t border-slate-100 pt-3"><summary className="cursor-pointer text-xs font-semibold text-[#174ea6]">Datos comerciales opcionales</summary><label className="mt-3 flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={advanced} onChange={(event) => setAdvanced(event.target.checked)} />Usar fecha, estado, asesor o campaña presentes en el archivo</label>{advanced ? <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">{select("Fecha", "soldAt")}{select("Estado", "status")}{select("Asesor", "advisor")}{select("Campaña", "campaign")}<label className="text-xs font-semibold text-slate-700">Periodo declarado<input value={period} onChange={(event) => setPeriod(event.target.value)} placeholder="Opcional" className="mt-1 block min-h-9 w-full rounded-md border border-slate-300 px-2 text-sm font-normal" /></label></div> : null}</details></section>{preview ? <section className="border border-slate-200 bg-white p-4"><p className="text-sm font-semibold">Previsualización</p><dl className="mt-3 grid grid-cols-2 gap-3 text-xs sm:grid-cols-5"><div><dt>Total filas</dt><dd className="font-semibold">{preview.summary.totalRows}</dd></div><div><dt>Válidos únicos</dt><dd className="font-semibold">{preview.summary.validUnique}</dd></div><div><dt>Inválidos</dt><dd className="font-semibold">{preview.summary.invalid}</dd></div><div><dt>Repetidos</dt><dd className="font-semibold">{preview.summary.duplicates}</dd></div><div><dt>Ya bloqueados</dt><dd className="font-semibold">{previouslyBlocked ?? "Comprobando…"}</dd></div></dl>{preview.summary.validUnique ? <button type="button" disabled={isSubmitting} onClick={() => void confirm()} className="mt-4 rounded-md bg-[#174ea6] px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-400">{isSubmitting ? "Registrando…" : "Registrar ventas"}</button> : <p className="mt-4 text-sm text-amber-800">No hay móviles válidos para registrar. Las incidencias permanecen visibles en este resumen.</p>}</section> : <p className="text-sm text-amber-800">Selecciona la columna de móvil para previsualizar.</p>}</> : null}<section className="border border-slate-200 bg-white p-4"><p className="text-sm font-semibold">Historial de importaciones</p>{history.length ? <div className="mt-3 divide-y divide-slate-100 border-y border-slate-100">{history.map((item) => <div key={item.id} className="flex items-center justify-between gap-3 py-3 text-xs"><div className="min-w-0"><p className="truncate font-semibold text-slate-900">{item.nombreArchivo}</p><p className="mt-1 text-slate-500">{new Date(item.creadoEn).toLocaleString("es-PE")} · Válidos {item.resumen?.validUnique ?? 0} · Ya bloqueados {item.resumen?.alreadyBlocked ?? 0}</p></div></div>)}</div> : <p className="mt-3 text-xs text-slate-500">Aún no hay importaciones registradas.</p>}</section>{message ? <p role="status" className="text-sm text-slate-700">{message}</p> : null}</section>;
}
