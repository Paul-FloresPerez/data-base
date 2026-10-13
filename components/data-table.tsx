"use client";

import { useDeferredValue, useMemo, useState } from "react";

interface TableRow {
  id: string;
  cells: string[];
}

interface DataTableProps {
  caption: string;
  columns: string[];
  emptyMessage: string;
  pageSize?: number;
  rows: TableRow[];
}

export function DataTable({ caption, columns, emptyMessage, pageSize = 8, rows }: DataTableProps) {
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState("all");
  const deferredQuery = useDeferredValue(query);
  const filteredRows = useMemo(() => {
    const normalizedQuery = deferredQuery.trim().toLocaleLowerCase("es-ES");

    if (!normalizedQuery) {
      return rows;
    }

    const scopedIndex = scope === "all" ? undefined : Number(scope);
    return rows.filter((row) => {
      const searchableCells = scopedIndex === undefined ? row.cells : [row.cells[scopedIndex] ?? ""];
      return searchableCells.some((cell) => cell.toLocaleLowerCase("es-ES").includes(normalizedQuery));
    });
  }, [deferredQuery, rows, scope]);
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const visibleRows = useMemo(
    () => filteredRows.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    [currentPage, filteredRows, pageSize],
  );

  function updateQuery(value: string) {
    setQuery(value);
    setPage(1);
  }

  function updateScope(value: string) {
    setScope(value);
    setPage(1);
  }

  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      <div className="flex flex-col gap-2 border-b border-slate-200 bg-slate-50/70 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs font-medium text-slate-600"><span className="font-semibold text-slate-900 tabular-nums">{filteredRows.length}</span> registros</p>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <label className="sr-only" htmlFor={`${caption}-scope`}>Columna para filtrar</label>
          <select id={`${caption}-scope`} value={scope} onChange={(event) => updateScope(event.target.value)} className="min-h-8 rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-700 outline-none focus:border-[#174ea6] focus:ring-2 focus:ring-blue-100">
            <option value="all">Todas las columnas</option>
            {columns.map((column, index) => <option key={`${column}-${index}`} value={String(index)}>{column}</option>)}
          </select>
          <label className="sr-only" htmlFor={`${caption}-search`}>Buscar en la tabla</label>
          <input id={`${caption}-search`} type="search" value={query} onChange={(event) => updateQuery(event.target.value)} placeholder="Buscar" className="min-h-8 w-full rounded-md border border-slate-200 bg-white px-2.5 text-xs text-slate-800 outline-none placeholder:text-slate-400 focus:border-[#174ea6] focus:ring-2 focus:ring-blue-100 sm:w-44" />
        </div>
      </div>
      <div className="max-w-full overflow-x-auto">
        <table className="w-full min-w-max border-collapse text-left text-[13px]">
          <caption className="sr-only">{caption}</caption>
          <thead className="bg-white text-[10px] font-bold uppercase tracking-[0.1em] text-slate-500">
            <tr>
              {columns.map((column, index) => (
                <th key={`${column}-${index}`} scope="col" className="whitespace-nowrap border-b border-slate-200 px-3 py-2">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-slate-700">
            {visibleRows.length > 0 ? (
              visibleRows.map((row) => (
                <tr key={row.id} className="transition-colors hover:bg-blue-50/40">
                  {row.cells.map((cell, index) => (
                    <td key={`${row.id}-${columns[index] ?? index}`} className="max-w-56 px-3 py-2 align-top">
                      <span className="block truncate" title={cell}>{cell || "—"}</span>
                    </td>
                  ))}
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={columns.length} className="px-4 py-10 text-center text-sm text-slate-500">{query ? "No hay coincidencias para el filtro actual." : emptyMessage}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {filteredRows.length > 0 ? (
        <div className="flex flex-col gap-3 border-t border-slate-100 bg-slate-50 px-3 py-2.5 text-xs text-slate-600 sm:flex-row sm:items-center sm:justify-between">
          <p>Mostrando {(currentPage - 1) * pageSize + 1}–{Math.min(currentPage * pageSize, filteredRows.length)} de {filteredRows.length}</p>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={currentPage === 1} className="min-h-8 rounded-md border border-slate-200 bg-white px-2.5 font-semibold text-slate-700 transition-colors hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:cursor-not-allowed disabled:opacity-50" aria-label="Página anterior">Anterior</button>
            <span aria-live="polite" className="min-w-16 text-center font-medium">{currentPage} / {totalPages}</span>
            <button type="button" onClick={() => setPage((current) => Math.min(totalPages, current + 1))} disabled={currentPage === totalPages} className="min-h-8 rounded-md border border-slate-200 bg-white px-2.5 font-semibold text-slate-700 transition-colors hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:cursor-not-allowed disabled:opacity-50" aria-label="Página siguiente">Siguiente</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
