"use client";

import { useMemo, useRef, useState } from "react";
import { previewSalesImport, suggestSalesColumnMapping, type SalesColumnMapping } from "@/lib/sales/sales-import";

type SheetData = { name: string; headers: string[]; rows: { sourceRow: number; cells: string[] }[] };

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
  const [message, setMessage] = useState<string | null>(null);
  const preview = useMemo(() => sheet && mapping.mobile !== undefined ? previewSalesImport(sheet.rows, mapping as SalesColumnMapping) : null, [mapping, sheet]);

  async function load(file: File) {
    setMessage(null);
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
    } catch { setMessage("No se pudo leer el Excel de ventas."); }
  }

  async function confirm() {
    if (!preview || !sheet) return;
    setMessage(null);
    const importId = crypto.randomUUID();
    try {
      const sourceFingerprint = await fingerprint(JSON.stringify({ fileName, period, headers: sheet.headers, events: preview.events }));
      const response = await fetch("/api/ventas", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ importId, fileName, declaredPeriod: period || null, sourceFingerprint, events: preview.events }) });
      if (!response.ok) throw new Error();
      setMessage("Importación comercial registrada. Las ventas confirmadas quedan bloqueadas globalmente.");
    } catch { setMessage("No se pudo confirmar la importación. No se han mostrado datos personales."); }
  }

  const select = (label: string, value: keyof SalesColumnMapping, required = false) => <label className="text-xs font-semibold text-slate-700">{label}{required ? " *" : ""}<select value={mapping[value] ?? ""} onChange={(event) => setMapping((current) => ({ ...current, [value]: event.target.value === "" ? undefined : Number(event.target.value) }))} className="mt-1 block min-h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm font-normal"><option value="">No disponible</option>{sheet?.headers.map((header, index) => <option key={`${header}-${index}`} value={index}>{header || `Columna ${index + 1}`}</option>)}</select></label>;
  return <section className="space-y-5"><div className="border-b border-slate-200 pb-5"><p className="text-[10px] font-bold uppercase tracking-[.14em] text-[#174ea6]">Control comercial</p><h2 className="mt-1 text-2xl font-semibold text-[#0f274f]">Ventas</h2><p className="mt-2 max-w-3xl text-sm text-slate-600">Importa eventos comerciales externos. Una venta confirmada bloquea el móvil globalmente; los estados ambiguos quedan en revisión.</p></div><input ref={input} type="file" accept=".xlsx" className="sr-only" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void load(file); }} /><div className="flex flex-wrap items-end gap-3"><button type="button" onClick={() => input.current?.click()} className="rounded-md bg-[#174ea6] px-4 py-2 text-sm font-semibold text-white">Seleccionar Excel de ventas</button><label className="text-xs font-semibold text-slate-700">Periodo declarado<input value={period} onChange={(event) => setPeriod(event.target.value)} placeholder="Semana 45 / 2026" className="mt-1 block min-h-9 rounded-md border border-slate-300 px-2 text-sm font-normal" /></label></div>{sheet ? <><section className="border border-slate-200 bg-white p-4"><p className="text-sm font-semibold">Mapeo previo · {fileName}</p><p className="mt-1 text-xs text-slate-500">Hoja {sheet.name}. Ajusta el mapeo antes de confirmar; no se crean contactos desde este archivo.</p><div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">{select("Móvil", "mobile", true)}{select("Fecha", "soldAt")}{select("Estado", "status")}{select("Asesor", "advisor")}{select("Campaña", "campaign")}</div></section>{preview ? <section className="border border-slate-200 bg-white p-4"><dl className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4"><div><dt>Total filas</dt><dd className="font-semibold">{preview.summary.totalRows}</dd></div><div><dt>Válidos únicos</dt><dd className="font-semibold">{preview.summary.validUnique}</dd></div><div><dt>Inválidos / duplicados</dt><dd className="font-semibold">{preview.summary.invalid} / {preview.summary.duplicates}</dd></div><div><dt>Confirmadas / ambiguas</dt><dd className="font-semibold">{preview.summary.confirmed} / {preview.summary.ambiguous}</dd></div></dl><button type="button" onClick={() => void confirm()} className="mt-4 rounded-md bg-[#174ea6] px-4 py-2 text-sm font-semibold text-white">Confirmar importación comercial</button></section> : <p className="text-sm text-amber-800">Selecciona la columna de móvil para previsualizar.</p>}</> : null}{message ? <p role="status" className="text-sm text-slate-700">{message}</p> : null}</section>;
}
