"use client";
import type { ChangeEvent } from "react";
import { useMemo, useRef, useState } from "react";
import {
  defaultRecyclableTipifications,
  normalizeRecyclingTipification,
} from "@/lib/recycling/intelligent-recycling";
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
};
type Summary = {
  logicalMobiles: number;
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
async function hash(b: ArrayBuffer) {
  const d = await crypto.subtle.digest("SHA-256", b);
  return [...new Uint8Array(d)]
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}
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
  const [parsed, setParsed] = useState<Parsed | null>(null),
    [fileId, setFileId] = useState<string | null>(null),
    [summary, setSummary] = useState<Summary | null>(null),
    [preview, setPreview] = useState<Preview | null>(null),
    [selected, setSelected] = useState<Set<string>>(
      () => new Set(defaultRecyclableTipifications),
    ),
    [execution, setExecution] = useState<Execution | null>(null),
    [reasons, setReasons] = useState<Reason[]>([]),
    [busy, setBusy] = useState<string | null>(null),
    [message, setMessage] = useState<string | null>(null);
  const mobile = useMemo(
    () =>
      parsed
        ? col(parsed.headers, [
            "telefonomovil",
            "telefonosmovil",
            "movil",
            "celular",
            "nums",
            "numeroemitido",
          ])
        : -1,
    [parsed],
  );
  const tip = useMemo(
    () => (parsed ? col(parsed.headers, ["tipificacion", "resultado"]) : -1),
    [parsed],
  );
  const date = useMemo(
    () =>
      parsed
        ? col(parsed.headers, ["fecha", "fechagestion", "fechainstalacion"])
        : -1,
    [parsed],
  );
  const sale = useMemo(
    () =>
      parsed
        ? col(parsed.headers, [
            "ventaconfirmada",
            "venta",
            "estadoventa",
            "estadocomercial",
          ])
        : -1,
    [parsed],
  );
  const tips = useMemo<string[]>(
    () =>
      !parsed || tip < 0
        ? []
        : [
            ...new Set(
              parsed.rows
                .map((r) => normalizeRecyclingTipification(r[tip] ?? ""))
                .filter(Boolean),
            ),
          ].sort(),
    [parsed, tip],
  );
  const found = summary ? summary.logicalMobiles - summary.unmatched : 0;
  const toggle = (t: string) =>
    setSelected((s) => {
      const n = new Set(s);
      n.has(t) ? n.delete(t) : n.add(t);
      return n;
    });
  async function select(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setBusy("Leyendo Excel…");
    setMessage(null);
    setFileId(null);
    setSummary(null);
    setPreview(null);
    setExecution(null);
    setReasons([]);
    try {
      if (!/\.xlsx$/i.test(f.name))
        throw new Error("Selecciona un archivo XLSX del CRM.");
      const b = await f.arrayBuffer(),
        X = (await import("xlsx")).default ?? (await import("xlsx")),
        w = X.read(b, { cellText: true }),
        sheet =
          w.SheetNames.find((n) => n.toLocaleLowerCase("es-ES") === "datos") ??
          w.SheetNames[0];
      if (!sheet || !w.Sheets[sheet])
        throw new Error("El Excel no contiene una hoja legible.");
      const values = X.utils.sheet_to_json<string[]>(w.Sheets[sheet], {
          header: 1,
          raw: false,
          defval: "",
        }),
        headers = (values[0] ?? []).map(String);
      if (!headers.some((v) => v.trim()))
        throw new Error("El Excel no contiene encabezados legibles.");
      setParsed({
        fileName: f.name,
        importId: crypto.randomUUID(),
        fingerprint: await hash(b),
        sheet,
        headers,
        rows: values.slice(1).map((r) => r.map(String)),
      });
    } catch (x) {
      setMessage(x instanceof Error ? x.message : "No se pudo leer el Excel.");
    } finally {
      setBusy(null);
    }
  }
  async function register() {
    if (!parsed || mobile < 0) {
      setMessage(
        "No se identificó una columna de móvil confiable. Usa Teléfono Movil, nums o Número Emitido.",
      );
      return;
    }
    setBusy("Registrando archivo canónico…");
    try {
      const file = await api<{ id: string }>("/api/reciclaje-global/archivos", {
        method: "POST",
        body: JSON.stringify({
          importacionId: parsed.importId,
          huellaContenido: parsed.fingerprint,
          nombreArchivo: parsed.fileName,
          headers: parsed.headers,
        }),
      });
      for (let i = 0; i < parsed.rows.length; i += 100) {
        const rows = parsed.rows.slice(i, i + 100).map((cells, o) => {
          const v =
              sale >= 0
                ? (cells[sale] ?? "").trim().toLocaleUpperCase("es-ES")
                : "",
            confirmed = [
              "SI",
              "SÍ",
              "TRUE",
              "CONFIRMADA",
              "CONFIRMADO",
            ].includes(v);
          return {
            hoja: parsed.sheet,
            fila: i + o + 2,
            movil: cells[mobile] ?? "",
            fechaGestion: date >= 0 ? (cells[date] ?? "") || null : null,
            tipificacion: tip >= 0 ? (cells[tip] ?? "") || null : null,
            ventaConfirmada: confirmed,
            evidenciaVenta: confirmed
              ? "Venta confirmada indicada por el archivo CRM."
              : null,
            cells,
          };
        });
        await api(`/api/reciclaje-global/archivos/${file.id}/filas`, {
          method: "POST",
          body: JSON.stringify({ rows }),
        });
      }
      setFileId(file.id);
      setMessage(
        "Archivo registrado. Aún no se ha evaluado ni generado ninguna base.",
      );
    } catch (x) {
      setMessage(
        x instanceof Error ? x.message : "No se pudo registrar el archivo CRM.",
      );
    } finally {
      setBusy(null);
    }
  }
  async function conciliate() {
    if (!fileId) return;
    setBusy("Comparando con las bases originales activas…");
    try {
      const r = await api<{ summary: Summary; preview: Preview }>(
        `/api/reciclaje-global/archivos/${fileId}/conciliar`,
        { method: "POST" },
      );
      setSummary(r.summary);
      setPreview(r.preview);
      setMessage(
        r.summary.logicalMobiles > r.summary.unmatched
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
    if (!fileId || !selected.size) {
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
            archivoCrmIds: [fileId],
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
          ["Encontrados", found],
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
        accept=".xlsx"
        onChange={select}
      />
      <Step
        number={1}
        title="Cargar archivo CRM"
        detail="Selecciona el Excel y registra el archivo antes de compararlo."
      >
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => input.current?.click()}
            disabled={!!busy}
            className="min-h-10 rounded-md bg-[#174ea6] px-4 text-sm font-semibold text-white disabled:bg-slate-300"
          >
            Seleccionar Excel CRM
          </button>
          <button
            type="button"
            onClick={() => void register()}
            disabled={!parsed || mobile < 0 || !!busy || !!fileId}
            className="min-h-10 rounded-md border border-[#174ea6] px-4 text-sm font-semibold text-[#174ea6] disabled:border-slate-200 disabled:text-slate-400"
          >
            Registrar archivo
          </button>
          {parsed ? (
            <span className="text-xs text-slate-600">
              {parsed.fileName} · {parsed.rows.length} filas · móvil:{" "}
              {mobile >= 0 ? parsed.headers[mobile] : "no identificado"}
            </span>
          ) : null}
        </div>
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
          disabled={!fileId || !!busy || !!summary}
          className="min-h-10 rounded-md border border-[#174ea6] px-4 text-sm font-semibold text-[#174ea6] disabled:border-slate-200 disabled:text-slate-400"
        >
          Comprobar contra bases activas
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
            disabled={!found || !!busy || !!execution}
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
