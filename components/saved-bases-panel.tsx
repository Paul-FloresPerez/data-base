"use client";

import { useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import { restoreBatch, type LoadedBase } from "@/lib/persistence/workspace-persistence";
import { saveBatchToHistory } from "@/lib/persistence/client-base-save";
import type { WorkingBatch } from "@/lib/workspace/batch";
import { AuditHistoryPanel } from "@/components/audit-history-panel";
import { OriginalBaseSelector } from "@/components/original-base-selector";
import { filterHistoricalBases } from "@/lib/base-history/catalog";

interface SavedBaseSummary { id: string; code: string; name: string; originalFileName: string; receivedAt: string | null; originalBaseId: string | null; createdAt: string; updatedAt: string; archivedAt: string | null; state: string; kind: "ORIGINAL" | "RECICLADA"; imported: number; valid: number; excluded: number }
type AdministrativeDependencies = {
  id: string; code: string; kind: "ORIGINAL" | "RECICLADA"; archivedAt: string | null; archiveReason: string | null;
  dependencies: Record<string, number>; canPrepareControlledDeletion: boolean; requiredAction: "ELIMINACION_CONTROLADA_FUTURA" | "ARCHIVADO_LOGICO";
};

async function api<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const response = await fetch(input, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  if (!response.ok) throw new Error((await response.json().catch(() => null))?.error ?? "No se pudo completar la operación.");
  return response.json() as Promise<T>;
}

export function SavedBasesPanel({ batch, onOpen, onNavigate, onSaved }: { batch: WorkingBatch | null; onOpen: (batch: WorkingBatch) => void; onNavigate: (target?: "dashboard" | "reciclaje") => void; onSaved?: (name: string) => void }) {
  const [bases, setBases] = useState<SavedBaseSummary[]>([]);
  const [name, setName] = useState(batch?.displayName ?? batch?.fileName.replace(/\.xlsx$/i, "") ?? "");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<"all" | SavedBaseSummary["kind"]>("all");
  const [state, setState] = useState<"all" | string>("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [archiveFilter, setArchiveFilter] = useState<"active" | "archived" | "all">("active");
  const [receivedAt, setReceivedAt] = useState(batch?.receivedAt ?? "");
  const [originalBaseId, setOriginalBaseId] = useState(batch?.originalBaseId ?? "");
  const [administration, setAdministration] = useState<{ base: SavedBaseSummary; dependencies: AdministrativeDependencies } | null>(null);
  const [archiveReason, setArchiveReason] = useState("");
  const [adminPending, setAdminPending] = useState(false);
  const deferredQuery = useDeferredValue(query.trim().toLocaleLowerCase("es-ES"));
  const refresh = useCallback(async () => {
    setLoading(true);
    try { setBases((await api<{ bases: SavedBaseSummary[] }>("/api/bases")).bases); } catch { setMessage("No se pudo cargar el historial."); } finally { setLoading(false); }
  }, []);
  const visibleBases = useMemo(() => filterHistoricalBases(bases, { query: deferredQuery, kind, state, fromDate, toDate }).filter((base) => archiveFilter === "all" || (archiveFilter === "archived" ? Boolean(base.archivedAt) : !base.archivedAt)), [archiveFilter, bases, deferredQuery, fromDate, kind, state, toDate]);
  useEffect(() => {
    let cancelled = false;
    void api<{ bases: SavedBaseSummary[] }>("/api/bases")
      .then((result) => { if (!cancelled) setBases(result.bases); })
      .catch(() => { if (!cancelled) setMessage("No se pudo cargar el historial."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  async function save() {
    if (!batch || !name.trim() || (batch.kind === "RECICLADA" && !originalBaseId)) return;
    if (!window.confirm(`¿Guardar “${name.trim()}” en Mis bases? Podrás abrirla y continuarla después.`)) return;
    setSaving(true); setMessage(null);
    try {
      await saveBatchToHistory({ ...batch, displayName: name.trim(), receivedAt: receivedAt || null, originalBaseId: originalBaseId || null }, name);
      onSaved?.(name.trim());
      setMessage("Base guardada en el historial.");
      await refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "No se pudo guardar la base."); } finally { setSaving(false); }
  }
  async function open(id: string) {
    setMessage(null);
    try { const { base } = await api<{ base: LoadedBase }>(`/api/bases/${id}`); onOpen(restoreBatch(base)); onNavigate(); } catch { setMessage("No se pudo abrir la base guardada."); }
  }
  async function openRecyclingHistory(id: string) {
    setMessage(null);
    try {
      const { base } = await api<{ base: LoadedBase }>(`/api/bases/${id}`);
      onOpen(restoreBatch(base));
      onNavigate("reciclaje");
    } catch {
      setMessage("No se pudo abrir el historial de reciclajes.");
    }
  }
  async function manage(base: SavedBaseSummary) {
    setMessage(null); setArchiveReason("");
    try {
      const dependencies = await api<AdministrativeDependencies>(`/api/bases/${base.id}/administracion`);
      setAdministration({ base, dependencies });
    } catch (error) { setMessage(error instanceof Error ? error.message : "No se pudo consultar las dependencias de la base."); }
  }
  async function updateArchive(action: "archive" | "restore") {
    if (!administration) return;
    if (action === "archive" && archiveReason.trim().length < 3) { setMessage("Indica un motivo de archivado de al menos 3 caracteres."); return; }
    setAdminPending(true); setMessage(null);
    try {
      await api(`/api/bases/${administration.base.id}/administracion`, { method: "POST", body: JSON.stringify({ action, operationId: crypto.randomUUID(), ...(action === "archive" ? { reason: archiveReason.trim() } : {}) }) });
      setAdministration(null); setMessage(action === "archive" ? "Base archivada correctamente. Su historial, lotes y reservas permanecen intactos." : "Base restaurada correctamente."); await refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Error de servidor al actualizar el archivado."); } finally { setAdminPending(false); }
  }
  return <section className="space-y-5" aria-labelledby="mis-bases-title">
    <div className="border-b border-slate-200 pb-5"><p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#174ea6]">Historial privado</p><h2 id="mis-bases-title" className="mt-1 text-2xl font-semibold tracking-tight text-[#0f274f] sm:text-3xl">Mis bases</h2><p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">Abre una base para recuperar su avance sin repetir el enriquecimiento.</p></div>
    {batch ? <section className="border border-slate-200 bg-white p-5"><div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_180px_auto]"><label className="min-w-0 text-sm font-semibold text-slate-800">Nombre descriptivo<input value={name} maxLength={180} onChange={(event) => setName(event.target.value)} className="mt-2 min-h-10 w-full rounded-md border border-slate-300 px-3 text-sm font-normal outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100" /></label><label className="text-sm font-semibold text-slate-800">Fecha de recepción<input type="date" value={receivedAt} onChange={(event) => setReceivedAt(event.target.value)} className="mt-2 min-h-10 w-full rounded-md border border-slate-300 px-3 text-sm font-normal outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100" /></label><button type="button" disabled={saving || !name.trim() || (batch.kind === "RECICLADA" && !originalBaseId)} onClick={() => void save()} className="self-end inline-flex min-h-10 items-center justify-center rounded-md bg-[#174ea6] px-4 text-sm font-semibold text-white hover:bg-[#123f87] disabled:bg-slate-300">{saving ? "Guardando…" : "Guardar base"}</button></div>{batch.kind === "RECICLADA" ? <div className="mt-4"><OriginalBaseSelector value={originalBaseId} onChange={setOriginalBaseId} disabled={saving} label="Base original seleccionada" /></div> : null}<p className="mt-3 text-xs leading-5 text-slate-500">Archivo original: {batch.fileName}. La fecha de recepción puede ser histórica y no se infiere de la importación. El Excel original no se altera.</p></section> : <section className="border border-dashed border-slate-300 bg-white px-5 py-8 text-center text-sm text-slate-600">No hay una base activa para guardar. Importa o abre una base para continuar.</section>}
    {message ? <p role="status" className="border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">{message}</p> : null}
    <section className="overflow-hidden border border-slate-200 bg-white"><div className="flex flex-col gap-3 border-b border-slate-200 px-4 py-4"><div><p className="text-sm font-semibold text-slate-900">Biblioteca de bases</p><p className="mt-1 text-xs text-slate-500">{visibleBases.length} de {bases.length} visibles</p></div><div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-6"><label className="sr-only" htmlFor="saved-base-search">Buscar bases</label><input id="saved-base-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Nombre, código o archivo" className="min-h-9 rounded-md border border-slate-300 px-3 text-sm outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100" /><select value={kind} onChange={(event) => setKind(event.target.value as typeof kind)} className="min-h-9 rounded-md border border-slate-300 bg-white px-3 text-sm outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100"><option value="all">Todos los tipos</option><option value="ORIGINAL">Original</option><option value="RECICLADA">Reciclada</option></select><select aria-label="Estado de archivado" value={archiveFilter} onChange={(event) => setArchiveFilter(event.target.value as typeof archiveFilter)} className="min-h-9 rounded-md border border-slate-300 bg-white px-3 text-sm outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100"><option value="active">Activas</option><option value="archived">Archivadas</option><option value="all">Todas</option></select><select value={state} onChange={(event) => setState(event.target.value)} className="min-h-9 rounded-md border border-slate-300 bg-white px-3 text-sm outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100"><option value="all">Todos los estados</option><option value="LISTA_PARA_LIMPIAR">Para limpiar</option><option value="LISTA_PARA_ENRIQUECER">Para enriquecer</option><option value="LISTA_PARA_DISTRIBUIR">Para distribuir</option></select><input aria-label="Recepción desde" type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} className="min-h-9 rounded-md border border-slate-300 px-3 text-sm" /><input aria-label="Recepción hasta" type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} className="min-h-9 rounded-md border border-slate-300 px-3 text-sm" /></div></div>{loading ? <p className="px-5 py-8 text-sm text-slate-600">Cargando historial…</p> : bases.length === 0 ? <p className="px-5 py-8 text-sm text-slate-600">Aún no hay bases guardadas.</p> : visibleBases.length === 0 ? <p className="px-5 py-8 text-sm text-slate-600">No hay bases que coincidan con los filtros.</p> : <div className="divide-y divide-slate-100">{visibleBases.map((saved) => <article key={saved.id} className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><code className="text-xs font-semibold text-[#174ea6]">{saved.code}</code><p className="truncate text-sm font-semibold text-slate-900">{saved.name}</p><span className="border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-bold text-slate-600">{saved.kind}</span><span className="border border-blue-100 bg-blue-50 px-1.5 py-0.5 text-[10px] font-bold text-[#174ea6]">{saved.state.replaceAll("_", " ")}</span>{saved.archivedAt ? <span className="border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold text-amber-800">ARCHIVADA</span> : <span className="border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold text-emerald-800">ACTIVA</span>}</div><p className="mt-1 text-xs text-slate-500">{saved.originalFileName} · Recepción: {saved.receivedAt ?? "sin registrar"} · {saved.imported} registros · {saved.valid} válidos · {saved.excluded} excluidos</p></div><div className="flex shrink-0 flex-wrap gap-2"><button type="button" onClick={() => void open(saved.id)} className="rounded-md bg-[#174ea6] px-3 py-2 text-xs font-semibold text-white hover:bg-[#123f87]">{saved.archivedAt ? "Consultar" : saved.state === "LISTA_PARA_DISTRIBUIR" ? "Continuar" : "Abrir"}</button>{saved.kind === "ORIGINAL" ? <button type="button" onClick={() => void openRecyclingHistory(saved.id)} className="rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">Reciclajes</button> : null}<button type="button" aria-label={`Administrar ${saved.name}`} onClick={() => void manage(saved)} className="rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">Administrar</button></div></article>)}</div>}</section>
    {administration ? <div role="dialog" aria-modal="true" aria-labelledby="base-administration-title" className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 p-4"><section className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-lg bg-white p-5 shadow-xl"><div className="flex items-start justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-wide text-[#174ea6]">Administración reversible</p><h3 id="base-administration-title" className="mt-1 text-lg font-semibold text-slate-900">{administration.base.name}</h3><p className="mt-1 text-xs text-slate-600">{administration.dependencies.archivedAt ? "Esta base está archivada y se conserva íntegra." : "Archivar la excluye de nuevos trabajos; no borra registros ni libera reservas."}</p></div><button type="button" onClick={() => setAdministration(null)} className="rounded px-2 py-1 text-sm text-slate-600 hover:bg-slate-100">Cerrar</button></div><div className="mt-4 border-y border-slate-200 py-3 text-sm text-slate-700"><p className="font-semibold text-slate-900">Dependencias conservadas</p><p className="mt-1">Lotes: {administration.dependencies.dependencies.lotes ?? 0} · Reservas activas: {administration.dependencies.dependencies.activeReservations ?? 0} · Reciclajes: {(administration.dependencies.dependencies.ejecucionesReciclaje ?? 0) + (administration.dependencies.dependencies.ejecucionesReciclajeGlobal ?? 0)} · Exportaciones: {administration.dependencies.dependencies.exportaciones ?? 0}</p><p className="mt-2 text-xs text-slate-500">No existe eliminación física desde esta interfaz. Las dependencias comerciales e históricas permanecen sin cambios.</p></div>{administration.dependencies.archivedAt ? <div className="mt-4"><p className="text-sm text-slate-700">Motivo registrado: {administration.dependencies.archiveReason ?? "No disponible"}</p><button type="button" disabled={adminPending} onClick={() => void updateArchive("restore")} className="mt-4 min-h-10 rounded-md bg-[#174ea6] px-4 text-sm font-semibold text-white disabled:bg-slate-300">{adminPending ? "Restaurando…" : "Restaurar base"}</button></div> : <div className="mt-4"><label className="block text-sm font-semibold text-slate-800">Motivo de archivado<textarea value={archiveReason} onChange={(event) => setArchiveReason(event.target.value)} maxLength={500} className="mt-2 min-h-20 w-full rounded-md border border-slate-300 p-3 text-sm font-normal outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100" placeholder="Ej.: base sustituida o cerrada operativamente" /></label><button type="button" disabled={adminPending || archiveReason.trim().length < 3} onClick={() => void updateArchive("archive")} className="mt-4 min-h-10 rounded-md border border-amber-300 bg-amber-50 px-4 text-sm font-semibold text-amber-900 disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400">{adminPending ? "Archivando…" : "Confirmar archivado lógico"}</button></div>}</section></div> : null}
    <AuditHistoryPanel />
  </section>;
}
