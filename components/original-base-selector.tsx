"use client";

import { useDeferredValue, useEffect, useId, useState } from "react";
import type { OriginalBaseOption } from "@/lib/base-history/original-base-search";

type SearchResult = { bases: OriginalBaseOption[]; total: number; page: number; limit: number; selected: OriginalBaseOption | null };

async function searchBases(query: string, page: number, selectedId: string, signal: AbortSignal): Promise<SearchResult> {
  const params = new URLSearchParams({ purpose: "original-selector", q: query, page: String(page), limit: "12" });
  if (selectedId) params.set("selectedId", selectedId);
  const response = await fetch(`/api/bases?${params}`, { signal, headers: { accept: "application/json" } });
  if (!response.ok) throw new Error("No se pudieron buscar las bases originales.");
  return response.json() as Promise<SearchResult>;
}

function baseLabel(base: OriginalBaseOption): string {
  return `${base.code} · ${base.name}`;
}

export function OriginalBaseSelector({ value, onChange, disabled = false, label = "Base original" }: { value: string; onChange: (baseId: string) => void; disabled?: boolean; label?: string }) {
  const inputId = useId();
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [page, setPage] = useState(0);
  const [result, setResult] = useState<SearchResult | null>(null);
  const [selected, setSelected] = useState<OriginalBaseOption | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void searchBases(deferredQuery, page, value, controller.signal)
      .then((next) => { setResult(next); if (next.selected) setSelected(next.selected); if (!controller.signal.aborted) setLoading(false); })
      .catch((caught) => { if (caught instanceof DOMException && caught.name === "AbortError") return; setError("No se pudieron buscar las bases originales."); setLoading(false); });
    return () => controller.abort();
  }, [deferredQuery, page, value]);

  function choose(base: OriginalBaseOption) {
    setSelected(base);
    onChange(base.id);
    setOpen(false);
    setQuery("");
  }

  const hasPrevious = (result?.page ?? 0) > 0;
  const hasNext = result ? (result.page + 1) * result.limit < result.total : false;
  return <div className="relative">
    <label htmlFor={inputId} className="block text-sm font-semibold text-slate-800">{label}</label>
    {selected ? <div className="mt-2 flex items-start justify-between gap-3 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-950"><div className="min-w-0"><p className="font-semibold">{baseLabel(selected)}</p><p className="mt-0.5 truncate text-xs text-blue-800">{selected.originalFileName} · {selected.receivedAt ?? "sin fecha de recepción"} · {selected.imported} registros · {selected.state.replaceAll("_", " ")}</p></div><button type="button" disabled={disabled} onClick={() => { setSelected(null); onChange(""); setOpen(true); }} className="shrink-0 text-xs font-semibold text-[#174ea6] disabled:text-slate-400">Cambiar</button></div> : null}
    <input id={inputId} role="combobox" type="search" value={query} disabled={disabled} onFocus={() => setOpen(true)} onKeyDown={(event) => { if (event.key === "Escape") setOpen(false); if (event.key === "ArrowDown") setOpen(true); }} onChange={(event) => { setQuery(event.target.value); setPage(0); setError(null); setLoading(true); setOpen(true); }} placeholder="Código, nombre o archivo original" className="mt-2 min-h-10 w-full rounded-md border border-slate-300 px-3 text-sm outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-100" aria-autocomplete="list" aria-expanded={open} aria-controls={`${inputId}-results`} />
    {open ? <div id={`${inputId}-results`} role="listbox" aria-label="Resultados de bases originales" className="relative z-10 mt-2 max-h-72 overflow-auto rounded-md border border-slate-200 bg-white shadow-sm">
      {loading ? <p className="px-3 py-3 text-sm text-slate-600">Buscando bases…</p> : null}
      {!loading && error ? <p role="status" className="px-3 py-3 text-sm text-rose-700">{error}</p> : null}
      {!loading && !error && result?.bases.length === 0 ? <p className="px-3 py-3 text-sm text-slate-600">No hay bases originales que coincidan.</p> : null}
      {!loading && !error ? result?.bases.map((base) => <button key={base.id} type="button" role="option" aria-selected={base.id === value} onClick={() => choose(base)} className="block w-full border-b border-slate-100 px-3 py-3 text-left text-sm last:border-b-0 hover:bg-slate-50 focus:bg-blue-50 focus:outline-none"><span className="block font-semibold text-slate-900">{baseLabel(base)}</span><span className="mt-1 block text-xs text-slate-500">{base.originalFileName} · {base.receivedAt ?? "sin fecha de recepción"} · {base.imported} registros · {base.state.replaceAll("_", " ")}</span></button>) : null}
      {!loading && !error && result && result.total > result.limit ? <div className="flex items-center justify-between gap-3 border-t border-slate-200 px-3 py-2 text-xs"><span>{result.total} resultados</span><span className="flex gap-3"><button type="button" disabled={!hasPrevious} onClick={() => { setLoading(true); setPage((current) => current - 1); }} className="font-semibold text-[#174ea6] disabled:text-slate-400">Anterior</button><button type="button" disabled={!hasNext} onClick={() => { setLoading(true); setPage((current) => current + 1); }} className="font-semibold text-[#174ea6] disabled:text-slate-400">Siguiente</button></span></div> : null}
    </div> : null}
  </div>;
}
