"use client";

import { useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import { restoreBatch, type LoadedBase } from "@/lib/persistence/workspace-persistence";
import { saveBatchToHistory } from "@/lib/persistence/client-base-save";
import type { WorkingBatch } from "@/lib/workspace/batch";
import { AuditHistoryPanel } from "@/components/audit-history-panel";

interface SavedBaseSummary { id: string; name: string; createdAt: string; updatedAt: string; state: string; kind: "ORIGINAL" | "RECICLADA"; imported: number; valid: number; excluded: number }

async function api<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const response = await fetch(input, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  if (!response.ok) throw new Error((await response.json().catch(() => null))?.error ?? "No se pudo completar la operación.");
  return response.json() as Promise<T>;
}

export function SavedBasesPanel({ batch, onOpen, onNavigate, onSaved }: { batch: WorkingBatch | null; onOpen: (batch: WorkingBatch) => void; onNavigate: () => void; onSaved?: (name: string) => void }) {
  const [bases, setBases] = useState<SavedBaseSummary[]>([]);
  const [name, setName] = useState(batch?.displayName ?? batch?.fileName.replace(/\.xlsx$/i, "") ?? "");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<"all" | SavedBaseSummary["kind"]>("all");
  const deferredQuery = useDeferredValue(query.trim().toLocaleLowerCase("es-ES"));
  const refresh = useCallback(async () => {
    setLoading(true);
    try { setBases((await api<{ bases: SavedBaseSummary[] }>("/api/bases")).bases); } catch { setMessage("No se pudo cargar el historial."); } finally { setLoading(false); }
  }, []);
  const visibleBases = useMemo(() => bases.filter((saved) => (kind === "all" || saved.kind === kind) && (!deferredQuery || `${saved.name} ${saved.state} ${saved.kind}`.toLocaleLowerCase("es-ES").includes(deferredQuery))), [bases, deferredQuery, kind]);
  useEffect(() => {
    let cancelled = false;
    void api<{ bases: SavedBaseSummary[] }>("/api/bases")
      .then((result) => { if (!cancelled) setBases(result.bases); })
      .catch(() => { if (!cancelled) setMessage("No se pudo cargar el historial."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  async function save() {
    if (!batch || !name.trim()) return;
    if (!window.confirm(`¿Guardar “${name.trim()}” en Mis bases? Podrás abrirla y continuarla después.`)) return;
    setSaving(true); setMessage(null);
    try {
      await saveBatchToHistory({ ...batch, displayName: name.trim() }, name);
      onSaved?.(name.trim());
      setMessage("Base guardada en el historial.");
      await refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "No se pudo guardar la base."); } finally { setSaving(false); }
  }
  async function open(id: string) {
    setMessage(null);
    try { const { base } = await api<{ base: LoadedBase }>(`/api/bases/${id}`); onOpen(restoreBatch(base)); onNavigate(); } catch { setMessage("No se pudo abrir la base guardada."); }
  }
  async function remove(id: string, baseName: string) {
    if (!window.confirm(`¿Eliminar “${baseName}”? Esta acción no se puede deshacer.`)) return;
    try { await api(`/api/bases/${id}`, { method: "DELETE" }); await refresh(); } catch { setMessage("No se pudo eliminar la base."); }
  }
  return <section className="space-y-5" aria-labelledby="mis-bases-title">
    <div className="border-b border-slate-200 pb-5"><p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#174ea6]">Historial privado</p><h2 id="mis-bases-title" className="mt-1 text-2xl font-semibold tracking-tight text-[#0f274f] sm:text-3xl">Mis bases</h2><p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">Abre una base para recuperar su avance sin repetir el enriquecimiento.</p></div>
    {batch ? <section className="border border-slate-200 bg-white p-5"><div className="flex flex-col gap-4 sm:flex-row sm:items-end"><label className="min-w-0 flex-1 text-sm font-semibold text-slate-800">Nombre de la base<input value={name} maxLength={180} onChange={(event) => setName(event.target.value)} className="mt-2 min-h-10 w-full rounded-md border border-slate-300 px-3 text-sm font-normal outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100" /></label><button type="button" disabled={saving || !name.trim()} onClick={() => void save()} className="inline-flex min-h-10 items-center justify-center rounded-md bg-[#174ea6] px-4 text-sm font-semibold text-white hover:bg-[#123f87] disabled:bg-slate-300">{saving ? "Guardando…" : "Guardar base"}</button></div><p className="mt-3 text-xs leading-5 text-slate-500">Se guarda una copia de los registros procesados y su configuración. El Excel original no se altera.</p></section> : <section className="border border-dashed border-slate-300 bg-white px-5 py-8 text-center text-sm text-slate-600">No hay una base activa para guardar. Importa o abre una base para continuar.</section>}
    {message ? <p role="status" className="border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">{message}</p> : null}
    <section className="overflow-hidden border border-slate-200 bg-white"><div className="flex flex-col gap-3 border-b border-slate-200 px-4 py-4 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-sm font-semibold text-slate-900">Bases guardadas</p><p className="mt-1 text-xs text-slate-500">{visibleBases.length} de {bases.length} visibles</p></div><div className="flex flex-col gap-2 sm:flex-row"><label className="sr-only" htmlFor="saved-base-search">Buscar bases</label><input id="saved-base-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar base" className="min-h-9 rounded-md border border-slate-300 px-3 text-sm outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100" /><select value={kind} onChange={(event) => setKind(event.target.value as typeof kind)} className="min-h-9 rounded-md border border-slate-300 bg-white px-3 text-sm outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100"><option value="all">Todos los tipos</option><option value="ORIGINAL">Original</option><option value="RECICLADA">Reciclada</option></select></div></div>{loading ? <p className="px-5 py-8 text-sm text-slate-600">Cargando historial…</p> : bases.length === 0 ? <p className="px-5 py-8 text-sm text-slate-600">Aún no hay bases guardadas.</p> : visibleBases.length === 0 ? <p className="px-5 py-8 text-sm text-slate-600">No hay bases que coincidan con los filtros.</p> : <div className="divide-y divide-slate-100">{visibleBases.map((saved) => <article key={saved.id} className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="truncate text-sm font-semibold text-slate-900">{saved.name}</p><span className="border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-bold text-slate-600">{saved.kind}</span><span className="border border-blue-100 bg-blue-50 px-1.5 py-0.5 text-[10px] font-bold text-[#174ea6]">{saved.state.replaceAll("_", " ")}</span></div><p className="mt-1 text-xs text-slate-500">{new Date(saved.updatedAt).toLocaleString("es-ES")} · {saved.imported} registros · {saved.valid} válidos · {saved.excluded} excluidos</p></div><div className="flex shrink-0 gap-2"><button type="button" onClick={() => void open(saved.id)} className="rounded-md bg-[#174ea6] px-3 py-2 text-xs font-semibold text-white hover:bg-[#123f87]">{saved.state === "LISTA_PARA_DISTRIBUIR" ? "Continuar" : "Abrir"}</button><button type="button" aria-label={`Eliminar ${saved.name}`} onClick={() => void remove(saved.id, saved.name)} className="rounded-md border border-rose-200 bg-white px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-50">Eliminar</button></div></article>)}</div>}</section>
    <AuditHistoryPanel />
  </section>;
}
