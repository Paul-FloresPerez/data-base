"use client";

import type { ChangeEvent } from "react";
import { useMemo, useRef, useState } from "react";

import { defaultRecyclableTipifications, normalizeRecyclingTipification } from "@/lib/recycling/intelligent-recycling";
import { restoreBatch, type LoadedBase } from "@/lib/persistence/workspace-persistence";
import type { WorkingBatch } from "@/lib/workspace/batch";

type Parsed = { fileName: string; importId: string; fingerprint: string; sheet: string; headers: string[]; rows: string[][] };
type GlobalSummary = { pages: number; logicalMobiles: number; unmatched: number; contradictions: number; associatedBases: number };
type Preview = { resumen: { filasInvalidas: number; movilesLogicos: number; encontrados: number; sinCoincidencias: number; enRevision: number } };
type Execution = { id: string; status: string; summary: Record<string, number> | null; recycledBaseId: string | null };
type ReasonSummary = { decision: string; reason: string; count: number };

async function api<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const response = await fetch(input, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  if (!response.ok) throw new Error((await response.json().catch(() => null) as { error?: string } | null)?.error ?? "No se pudo completar el reciclaje global.");
  return response.json() as Promise<T>;
}

function headerIndex(headers: readonly string[], names: readonly string[]) {
  const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es-ES").replace(/[^a-z0-9]/g, "");
  return headers.findIndex((header) => names.includes(normalize(header)));
}

async function fingerprint(bytes: ArrayBuffer) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

export function GlobalRecyclingWorkspace({ onOpen }: { onOpen: (batch: WorkingBatch) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [fileId, setFileId] = useState<string | null>(null);
  const [summary, setSummary] = useState<GlobalSummary | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(defaultRecyclableTipifications));
  const [execution, setExecution] = useState<Execution | null>(null);
  const [reasonSummary, setReasonSummary] = useState<ReasonSummary[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const mobileIndex = useMemo(() => parsed ? headerIndex(parsed.headers, ["telefonomovil", "telefonosmovil", "movil", "celular", "nums", "numeroemitido"]) : -1, [parsed]);
  const tipIndex = useMemo(() => parsed ? headerIndex(parsed.headers, ["tipificacion", "resultado"]) : -1, [parsed]);
  const dateIndex = useMemo(() => parsed ? headerIndex(parsed.headers, ["fecha", "fechagestion", "fechainstalacion"]) : -1, [parsed]);
  const saleIndex = useMemo(() => parsed ? headerIndex(parsed.headers, ["ventaconfirmada", "venta", "estadoventa", "estadocomercial"]) : -1, [parsed]);
  const tipifications = useMemo(() => {
    if (!parsed || tipIndex < 0) return [];
    return [...new Set(parsed.rows.map((row) => normalizeRecyclingTipification(row[tipIndex] ?? "")).filter(Boolean))].sort();
  }, [parsed, tipIndex]);

  async function selectFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; event.target.value = "";
    if (!file) return;
    setBusy("Leyendo Excel…"); setMessage(null); setFileId(null); setSummary(null); setPreview(null); setExecution(null); setReasonSummary([]);
    try {
      if (!/\.xlsx$/i.test(file.name)) throw new Error("Selecciona un archivo XLSX del CRM.");
      const bytes = await file.arrayBuffer();
      const imported = await import("xlsx"); const XLSX = imported.default ?? imported;
      const workbook = XLSX.read(bytes, { cellText: true }); const sheet = workbook.SheetNames.find((name) => name.toLocaleLowerCase("es-ES") === "datos") ?? workbook.SheetNames[0];
      if (!sheet || !workbook.Sheets[sheet]) throw new Error("El Excel no contiene una hoja legible.");
      const values = XLSX.utils.sheet_to_json<string[]>(workbook.Sheets[sheet], { header: 1, raw: false, defval: "" });
      const headers = (values[0] ?? []).map(String); if (!headers.some((value) => value.trim())) throw new Error("El Excel no contiene encabezados legibles.");
      setParsed({ fileName: file.name, importId: crypto.randomUUID(), fingerprint: await fingerprint(bytes), sheet, headers, rows: values.slice(1).map((row) => row.map(String)) });
    } catch (error) { setMessage(error instanceof Error ? error.message : "No se pudo leer el Excel."); } finally { setBusy(null); }
  }

  async function registerFile() {
    if (!parsed || mobileIndex < 0) { setMessage("No se identificó una columna de móvil confiable. Usa un encabezado como Teléfono Movil, nums o Número Emitido."); return; }
    setBusy("Registrando archivo canónico…"); setMessage(null);
    try {
      const file = await api<{ id: string }>("/api/reciclaje-global/archivos", { method: "POST", body: JSON.stringify({ importacionId: parsed.importId, huellaContenido: parsed.fingerprint, nombreArchivo: parsed.fileName, headers: parsed.headers }) });
      for (let index = 0; index < parsed.rows.length; index += 100) {
        const rows = parsed.rows.slice(index, index + 100).map((cells, offset) => {
          const saleValue = saleIndex >= 0 ? (cells[saleIndex] ?? "").trim().toLocaleUpperCase("es-ES") : "";
          const ventaConfirmada = ["SI", "SÍ", "TRUE", "CONFIRMADA", "CONFIRMADO"].includes(saleValue);
          return { hoja: parsed.sheet, fila: index + offset + 2, movil: cells[mobileIndex] ?? "", fechaGestion: dateIndex >= 0 ? (cells[dateIndex] ?? "") || null : null, tipificacion: tipIndex >= 0 ? (cells[tipIndex] ?? "") || null : null, ventaConfirmada, evidenciaVenta: ventaConfirmada ? "Venta confirmada indicada por el archivo CRM." : null, cells };
        });
        await api(`/api/reciclaje-global/archivos/${file.id}/filas`, { method: "POST", body: JSON.stringify({ rows }) });
      }
      setFileId(file.id); setMessage("Archivo canónico registrado. Aún no se ha evaluado ni generado ninguna base.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "No se pudo registrar el archivo CRM."); } finally { setBusy(null); }
  }

  async function conciliate() {
    if (!fileId) return; setBusy("Conciliando todas las bases originales…"); setMessage(null);
    try { const result = await api<{ summary: GlobalSummary; preview: Preview }>(`/api/reciclaje-global/archivos/${fileId}/conciliar`, { method: "POST" }); setSummary(result.summary); setPreview(result.preview); setMessage(result.summary.logicalMobiles > result.summary.unmatched ? "Conciliación global completada. Las contradicciones siguen en revisión." : "No se encontraron móviles coincidentes en las bases originales completas."); } catch (error) { setMessage(error instanceof Error ? error.message : "No se pudo conciliar el archivo CRM."); } finally { setBusy(null); }
  }

  async function createExecution() {
    if (!fileId || !selected.size) { setMessage("Selecciona al menos una tipificación para incluirla en la evaluación."); return; }
    setBusy("Preparando evaluación global…"); setMessage(null);
    try { const result = await api<{ id: string; status: string }>("/api/reciclaje-global", { method: "POST", body: JSON.stringify({ operationId: crypto.randomUUID(), archivoCrmIds: [fileId], criteria: { effectiveDate: new Date().toISOString().slice(0, 10), recyclableTipifications: [...selected], minimumMonths: 4, minimumDate: "2019-02-01" } }) }); setExecution({ id: result.id, status: result.status, summary: null, recycledBaseId: null }); } catch (error) { setMessage(error instanceof Error ? error.message : "No se pudo preparar la ejecución global."); } finally { setBusy(null); }
  }

  async function evaluate() {
    if (!execution) return; setBusy("Evaluando reglas comerciales…"); setMessage(null);
    try { const result = await api<{ id: string; status: string; summary: Record<string, number> }>(`/api/reciclaje-global/${execution.id}/evaluar`, { method: "POST" }); setExecution((current) => current ? { ...current, status: result.status, summary: result.summary } : current); const detail = await api<{ reasonSummary: ReasonSummary[] }>(`/api/reciclaje-global/${execution.id}?limit=1`); setReasonSummary(detail.reasonSummary); setMessage((result.summary.ELEGIBLE ?? 0) ? "Evaluación completada. Solo las decisiones ELEGIBLE podrán generar una base." : "No hay elegibles. Revisa los motivos agregados; una reserva activa requiere liberación explícita fuera de este flujo."); } catch (error) { setMessage(error instanceof Error ? error.message : "No se pudo evaluar."); } finally { setBusy(null); }
  }

  async function generate() {
    if (!execution) return; setBusy("Revalidando y generando…"); setMessage(null);
    try { const result = await api<{ baseId: string | null; included: number; excludedChanged: number }>(`/api/reciclaje-global/${execution.id}/generar`, { method: "POST" }); setExecution((current) => current ? { ...current, recycledBaseId: result.baseId } : current); setMessage(result.baseId ? `Base global creada con ${result.included} móviles. ${result.excludedChanged} cambiaron de condición al confirmar.` : `No se generó una base vacía; ${result.excludedChanged} móviles cambiaron de condición.`); } catch (error) { setMessage(error instanceof Error ? error.message : "No se pudo generar la base global."); } finally { setBusy(null); }
  }

  async function openBase() { if (!execution?.recycledBaseId) return; try { const loaded = await api<{ base: LoadedBase }>(`/api/bases/${execution.recycledBaseId}`); onOpen(restoreBatch(loaded.base)); setMessage("Base global recuperada. La exportación CRM conserva sus 24 encabezados."); } catch (error) { setMessage(error instanceof Error ? error.message : "No se pudo abrir la base generada."); } }
  const matchedMobiles = summary ? summary.logicalMobiles - summary.unmatched : 0;
  const canAdvance = matchedMobiles > 0;
  const toggleTipification = (type: string) => setSelected((current) => { const next = new Set(current); if (next.has(type)) next.delete(type); else next.add(type); return next; });
  return <section className="border border-slate-200 bg-white p-4"><div><p className="text-[10px] font-bold uppercase tracking-[.14em] text-[#174ea6]">Nuevo circuito</p><h2 className="mt-1 text-lg font-semibold text-[#0f274f]">Reciclaje global</h2><p className="mt-1 text-xs text-slate-600">Conciliación contra todas las bases originales completas. No crea distribución comercial ni reservas.</p></div><input ref={input} className="sr-only" type="file" accept=".xlsx" onChange={selectFile} /><div className="mt-4 flex flex-wrap gap-2"><button type="button" onClick={() => input.current?.click()} disabled={Boolean(busy)} className="rounded-md bg-[#174ea6] px-3 py-2 text-sm font-semibold text-white disabled:bg-slate-300">1. Seleccionar Excel CRM</button><button type="button" onClick={() => void registerFile()} disabled={!parsed || mobileIndex < 0 || Boolean(busy) || Boolean(fileId)} className="rounded-md border border-[#174ea6] px-3 py-2 text-sm font-semibold text-[#174ea6] disabled:border-slate-200 disabled:text-slate-400">2. Crear archivo canónico</button><button type="button" onClick={() => void conciliate()} disabled={!fileId || Boolean(busy) || Boolean(summary)} className="rounded-md border border-[#174ea6] px-3 py-2 text-sm font-semibold text-[#174ea6] disabled:border-slate-200 disabled:text-slate-400">3. Conciliar todas las bases</button></div>{parsed ? <p className="mt-3 text-xs text-slate-600">{parsed.fileName} · {parsed.rows.length} filas · columna móvil {mobileIndex >= 0 ? `“${parsed.headers[mobileIndex]}”` : "no identificada"}</p> : null}{preview && summary ? <dl className="mt-4 grid grid-cols-2 border border-slate-200 sm:grid-cols-5">{[["Móviles", summary.logicalMobiles], ["Coincidentes", matchedMobiles], ["Sin coincidencia", summary.unmatched], ["Contradicciones", summary.contradictions], ["Inválidos", preview.resumen.filasInvalidas]].map(([label, value]) => <div key={String(label)} className="border-b border-r border-slate-100 p-2"><dt className="text-[10px] font-bold uppercase text-slate-500">{label}</dt><dd className="text-base font-semibold text-slate-900">{value}</dd></div>)}</dl> : null}<section className="mt-4 border-t border-slate-200 pt-4"><p className="text-sm font-semibold text-slate-900">4. Tipificaciones para incluir en la evaluación</p><p className="mt-1 text-xs text-slate-500">Seleccionarlas indica qué gestiones se evalúan; no autoriza contacto ni crea elegibilidad.</p><div className="mt-2 flex flex-wrap gap-2">{tipifications.map((type) => <label key={type} className={`rounded-md border px-2 py-1 text-xs ${selected.has(type) ? "border-blue-600 bg-blue-50 text-blue-900" : "border-slate-200"}`}><input type="checkbox" checked={selected.has(type)} onChange={() => toggleTipification(type)} className="mr-1" />{type}</label>)}</div><div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={() => void createExecution()} disabled={!canAdvance || Boolean(busy) || Boolean(execution)} className="rounded-md border border-[#174ea6] px-3 py-2 text-sm font-semibold text-[#174ea6] disabled:border-slate-200 disabled:text-slate-400">4. Preparar evaluación</button><button type="button" onClick={() => void evaluate()} disabled={!execution || execution.status !== "PREPARADA" || Boolean(busy)} className="rounded-md border border-[#174ea6] px-3 py-2 text-sm font-semibold text-[#174ea6] disabled:border-slate-200 disabled:text-slate-400">5. Evaluar</button><button type="button" onClick={() => void generate()} disabled={!execution || execution.status !== "EVALUADA" || !(execution.summary?.ELEGIBLE ?? 0) || Boolean(execution.recycledBaseId) || Boolean(busy)} className="rounded-md bg-emerald-700 px-3 py-2 text-sm font-semibold text-white disabled:bg-slate-300">6. Generar base reciclada</button>{execution?.recycledBaseId ? <><button type="button" onClick={() => void openBase()} className="text-sm font-semibold text-[#174ea6]">Abrir base</button><a href={`/api/reciclaje-global/${execution.id}/descargar`} className="text-sm font-semibold text-[#174ea6]">Descargar XLSX CRM</a></> : null}</div>{execution?.summary ? <><p className="mt-3 text-xs text-slate-700">Evaluados {execution.summary.evaluated ?? 0} · Elegibles {execution.summary.ELEGIBLE ?? 0} · Excluidos {execution.summary.EXCLUIDO ?? 0} · Revisión {execution.summary.REVISION ?? 0} · Bloqueados {execution.summary.BLOQUEADO ?? 0}.</p>{reasonSummary.length ? <details className="mt-3 border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700"><summary className="cursor-pointer font-semibold">Motivos agregados de decisión</summary><ul className="mt-2 space-y-1">{reasonSummary.map((item) => <li key={`${item.decision}-${item.reason}`}><span className="font-semibold">{item.count}</span> · {item.decision}: {item.reason}</li>)}</ul></details> : null}</> : null}</section>{busy || message ? <p role="status" className="mt-4 text-xs text-slate-700">{busy ?? message}</p> : null}</section>;
}
