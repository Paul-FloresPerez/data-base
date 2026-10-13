"use client";

import { useMemo, useState } from "react";

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
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const visibleRows = useMemo(
    () => rows.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    [currentPage, pageSize, rows],
  );

  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      <div className="max-w-full overflow-x-auto">
        <table className="w-full min-w-max border-collapse text-left text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead className="bg-slate-50 text-[11px] font-bold uppercase tracking-wide text-slate-500">
            <tr>
              {columns.map((column, index) => (
                <th key={`${column}-${index}`} scope="col" className="whitespace-nowrap border-b border-slate-200 px-3 py-2.5">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-slate-700">
            {visibleRows.length > 0 ? (
              visibleRows.map((row) => (
                <tr key={row.id} className="hover:bg-slate-50">
                  {row.cells.map((cell, index) => (
                    <td key={`${row.id}-${columns[index] ?? index}`} className="max-w-56 px-3 py-2.5 align-top">
                      <span className="block truncate" title={cell}>{cell || "—"}</span>
                    </td>
                  ))}
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={columns.length} className="px-4 py-10 text-center text-sm text-slate-500">{emptyMessage}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {rows.length > 0 ? (
        <div className="flex flex-col gap-3 border-t border-slate-100 bg-slate-50 px-3 py-2.5 text-xs text-slate-600 sm:flex-row sm:items-center sm:justify-between">
          <p>Mostrando {(currentPage - 1) * pageSize + 1}–{Math.min(currentPage * pageSize, rows.length)} de {rows.length}</p>
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
