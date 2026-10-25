"use client";

import { useEffect, useState } from "react";

type AuditEvent = { id: string; createdAt: string; action: string; user: string; baseId: string; baseName: string; campaign: string | null; lotId: string | null; quantity: number | null; metadata: unknown };
type ExportRecord = { id: string; createdAt: string; campaign: string | null; lotNumber: number | null; type: string; state: "GENERADO" | "DESCARGA_INICIADA" | "ENTREGADO_CONFIRMADO"; quantity: number; recipient: string | null; baseName: string };
const labels: Record<string, string> = { BASE_CREADA: "Base creada", BASE_RECICLADA: "Base reciclada", ENRIQUECIMIENTO_APLICADO: "Enriquecimiento", CONFIGURACION_CAMPANA: "Configuración de campaña", LOTES_CREADOS: "Lotes creados", EXPORTACION_GENERADA: "Exportación generada", DESCARGA_INICIADA: "Descarga iniciada", ENTREGA_CONFIRMADA: "Entrega confirmada" };

export function AuditHistoryPanel() {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [exports, setExports] = useState<ExportRecord[]>([]);
  const [recipients, setRecipients] = useState<Record<string, string>>({});
  const [confirming, setConfirming] = useState<string | null>(null);
  const [campaign, setCampaign] = useState("");
  const [action, setAction] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const search = new URLSearchParams({ take: "20" });
    if (campaign) search.set("campaign", campaign);
    if (action) search.set("action", action);
    let cancelled = false;
    void Promise.all([
      fetch(`/api/auditoria?${search}`).then(async (response) => {
      if (!response.ok) throw new Error();
      return response.json() as Promise<{ events: AuditEvent[] }>;
      }),
      fetch("/api/auditoria/exportaciones").then(async (response) => {
        if (!response.ok) throw new Error();
        return response.json() as Promise<{ exports: ExportRecord[] }>;
      }),
    ]).then(([audit, exportRecords]) => { if (!cancelled) { setEvents(audit.events); setExports(exportRecords.exports); setError(null); } }).catch(() => { if (!cancelled) setError("No se pudo cargar la auditoría."); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [action, campaign]);
  async function confirmDelivery(exportId: string) {
    setConfirming(exportId);
    try {
      const response = await fetch(`/api/auditoria/exportaciones/${exportId}/confirmar`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ recipient: recipients[exportId] ?? "" }) });
      if (!response.ok) throw new Error();
      setExports((current) => current.map((entry) => entry.id === exportId ? { ...entry, state: "ENTREGADO_CONFIRMADO", recipient: recipients[exportId]?.trim() || null } : entry));
    } catch { setError("No se pudo confirmar la entrega."); } finally { setConfirming(null); }
  }
  return <section className="overflow-hidden border border-slate-200 bg-white" aria-labelledby="auditoria-title"><div className="flex flex-col gap-3 border-b border-slate-200 px-4 py-4 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-sm font-semibold text-slate-900" id="auditoria-title">Historial y auditoría</p><p className="mt-1 text-xs text-slate-500">Eventos operativos sin datos de contacto. Una descarga no equivale a una entrega.</p></div><div className="flex gap-2"><select aria-label="Filtrar campaña" value={campaign} onChange={(event) => setCampaign(event.target.value)} className="min-h-9 rounded-md border border-slate-300 bg-white px-2 text-sm"><option value="">Campañas</option><option value="YOIGO">Yoigo</option><option value="VODAFONE">Vodafone</option></select><select aria-label="Filtrar acción" value={action} onChange={(event) => setAction(event.target.value)} className="min-h-9 rounded-md border border-slate-300 bg-white px-2 text-sm"><option value="">Acciones</option>{Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div></div>{loading ? <p className="px-4 py-7 text-sm text-slate-600">Cargando eventos…</p> : error ? <p role="alert" className="px-4 py-7 text-sm text-rose-700">{error}</p> : <><div className="divide-y divide-slate-100">{events.length === 0 ? <p className="px-4 py-7 text-sm text-slate-600">Aún no hay eventos auditables para estos filtros.</p> : events.map((event) => <article key={event.id} className="grid gap-1 px-4 py-3 text-sm sm:grid-cols-[minmax(0,1fr)_auto]"><div><p className="font-medium text-slate-900">{labels[event.action] ?? event.action} <span className="ml-1 text-xs font-normal text-slate-500">{event.baseName}</span></p><p className="mt-1 text-xs text-slate-500">{event.user} · {event.campaign ?? "Sin campaña"}{event.quantity !== null ? ` · ${event.quantity} registros` : ""}{event.lotId ? " · lote registrado" : ""}</p></div><time className="text-xs text-slate-500">{new Date(event.createdAt).toLocaleString("es-ES")}</time></article>)}</div>{exports.some((entry) => entry.state === "DESCARGA_INICIADA") ? <div className="border-t border-slate-200 bg-slate-50 px-4 py-4"><p className="text-xs font-semibold uppercase tracking-[0.1em] text-slate-500">Confirmar entrega</p><p className="mt-1 text-xs text-slate-600">Registra una entrega solo cuando haya ocurrido. El destinatario es opcional.</p><div className="mt-3 space-y-2">{exports.filter((entry) => entry.state === "DESCARGA_INICIADA").map((entry) => <div key={entry.id} className="flex flex-col gap-2 border border-slate-200 bg-white p-3 sm:flex-row sm:items-center"><p className="min-w-0 flex-1 text-xs text-slate-700">{entry.baseName} · {entry.campaign ?? "Base maestra"} · {entry.quantity} registros{entry.lotNumber ? ` · lote ${entry.lotNumber}` : ""}</p><input aria-label={`Destinatario de ${entry.type}`} maxLength={180} value={recipients[entry.id] ?? ""} onChange={(event) => setRecipients((current) => ({ ...current, [entry.id]: event.target.value }))} placeholder="Destinatario (opcional)" className="min-h-9 rounded-md border border-slate-300 px-2 text-xs" /><button type="button" disabled={confirming === entry.id} onClick={() => void confirmDelivery(entry.id)} className="min-h-9 rounded-md border border-[#174ea6] px-2.5 text-xs font-semibold text-[#174ea6] disabled:opacity-60">{confirming === entry.id ? "Guardando…" : "Confirmar entrega"}</button></div>)}</div></div> : null}</>}</section>;
}
