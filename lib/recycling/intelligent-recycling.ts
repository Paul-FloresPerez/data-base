import { parsePortabilityDateParts } from "../excel/portability-date.ts";

export const defaultRecyclableTipifications = ["NO CONTESTA", "BUZÓN DE VOZ", "CORTA LLAMADA"] as const;
export const minimumPortabilityDate = "2019-02-01";

export type RecyclingTipificationCategory =
  | "CONTACTO_NO_ESTABLECIDO"
  | "CONTACTO_INTERRUMPIDO"
  | "SEGUIMIENTO_PENDIENTE"
  | "INTERES_COMERCIAL"
  | "VENTA_CRM_NO_CONFIRMADA"
  | "RECHAZO_COMERCIAL"
  | "DATOS_INCORRECTOS"
  | "OPOSICION_CONTACTO"
  | "OTROS_REQUIERE_REVISION";

export type RecyclingDecision = "ELEGIBLE" | "BLOQUEADO_VENTA" | "REVISION_GESTION" | "REVISION_CONFLICTO" | "REVISION_PERMANENCIA" | "FUERA_RANGO_HISTORICO";

export interface RecyclingOriginalRecord {
  id: string;
  mobile: string | null;
  portabilityDate: string | null;
}

export interface RecyclingManagement {
  id: string;
  mobile: string;
  managedAt: string | null;
  tipificationOriginal: string | null;
  confirmedSale: boolean;
  saleAmbiguous?: boolean;
  saleEvidence: string | null;
}

export interface RecyclingCriteria {
  effectiveDate: string;
  recyclableTipifications: readonly string[];
  minimumMonths: number;
  minimumDate: string;
}

export interface RecyclingDecisionRecord {
  originalRecordId: string;
  decision: RecyclingDecision;
  reason: string;
  winningManagementId: string | null;
}

export interface RecyclingEvaluation {
  decisions: RecyclingDecisionRecord[];
  incidentsOutsideBase: number;
  summary: Record<RecyclingDecision | "evaluated", number>;
}

function comparable(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleUpperCase("es-ES").replace(/\s+/g, " ").trim();
}

/** Keeps the source text separately; this is only the explicit comparison key. */
export function normalizeRecyclingTipification(value: string | null | undefined): string {
  const normalized = comparable(value ?? "");
  if (normalized === "NO RESPONDE" || normalized === "NO CONTESTA") return "NO CONTESTA";
  if (normalized === "BUZON DE VOZ") return "BUZÓN DE VOZ";
  return normalized;
}

/** Exact, auditable mappings only. Unknown CRM text remains conservative. */
export function classifyRecyclingTipification(value: string | null | undefined): RecyclingTipificationCategory {
  switch (normalizeRecyclingTipification(value)) {
    case "NO CONTESTA": case "BUZÓN DE VOZ": return "CONTACTO_NO_ESTABLECIDO";
    case "CORTA LLAMADA": return "CONTACTO_INTERRUMPIDO";
    case "AGENDADO": return "SEGUIMIENTO_PENDIENTE";
    case "INTERESADO": case "CONOCE EL METODO": return "INTERES_COMERCIAL";
    case "VENTA": case "VENDIDO": case "VENTA CONFIRMADA": return "VENTA_CRM_NO_CONFIRMADA";
    case "NO INTERESA": return "RECHAZO_COMERCIAL";
    case "OPERADOR INCORRECTO": case "NO ES TITULAR": case "TITULAR INCORRECTO": return "DATOS_INCORRECTOS";
    case "LISTA ROBINSON": case "OPOSICION": case "OPOSICIÓN": case "NO LLAMAR": case "NO CONTACTAR": return "OPOSICION_CONTACTO";
    default: return "OTROS_REQUIERE_REVISION";
  }
}

function day(value: string): Date | null {
  const parts = parsePortabilityDateParts(value);
  return parts ? new Date(Date.UTC(Number(parts.anio), Number(parts.mes) - 1, Number(parts.dia))) : null;
}

function completedCalendarMonths(from: Date, to: Date): number {
  let months = (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + to.getUTCMonth() - from.getUTCMonth();
  if (to.getUTCDate() < from.getUTCDate()) months -= 1;
  return Math.max(0, months);
}

function newestManagement(events: RecyclingManagement[]): { event: RecyclingManagement | null; conflict: boolean } {
  const dated = events.flatMap((event) => {
    const parsed = event.managedAt ? day(event.managedAt) : null;
    return parsed ? [{ event, date: parsed }] : [];
  });
  if (!dated.length) return { event: null, conflict: false };
  dated.sort((left, right) => right.date.getTime() - left.date.getTime());
  const newest = dated[0]!;
  const sameDay = dated.filter((entry) => entry.date.getTime() === newest.date.getTime());
  const types = new Set(sameDay.map((entry) => normalizeRecyclingTipification(entry.event.tipificationOriginal)));
  return { event: newest.event, conflict: types.size > 1 };
}

export function evaluateIntelligentRecycling(
  originals: readonly RecyclingOriginalRecord[],
  managements: readonly RecyclingManagement[],
  criteria: RecyclingCriteria,
  globallyBlockedMobiles: ReadonlySet<string> = new Set(),
  activelyReservedMobiles: ReadonlySet<string> = new Set(),
): RecyclingEvaluation {
  const allowed = new Set(criteria.recyclableTipifications.map(normalizeRecyclingTipification));
  const byMobile = new Map<string, RecyclingManagement[]>();
  for (const management of managements) {
    const values = byMobile.get(management.mobile) ?? [];
    values.push(management);
    byMobile.set(management.mobile, values);
  }
  const originMobiles = new Set(originals.flatMap((record) => record.mobile ? [record.mobile] : []));
  const incidentsOutsideBase = [...byMobile.keys()].filter((mobile) => !originMobiles.has(mobile)).length;
  const effective = day(criteria.effectiveDate);
  const minimum = day(criteria.minimumDate);
  if (!effective || !minimum || criteria.minimumMonths < 0) throw new Error("Criterios de reciclaje inválidos.");

  const decisions: RecyclingDecisionRecord[] = [];
  const summary: RecyclingEvaluation["summary"] = {
    evaluated: originals.length,
    ELEGIBLE: 0,
    BLOQUEADO_VENTA: 0,
    REVISION_GESTION: 0,
    REVISION_CONFLICTO: 0,
    REVISION_PERMANENCIA: 0,
    FUERA_RANGO_HISTORICO: 0,
  };

  for (const original of originals) {
    const events = original.mobile ? byMobile.get(original.mobile) ?? [] : [];
    const opposition = events.find((event) => classifyRecyclingTipification(event.tipificationOriginal) === "OPOSICION_CONTACTO");
    const pending = events.find((event) => {
      const category = classifyRecyclingTipification(event.tipificationOriginal);
      return category === "SEGUIMIENTO_PENDIENTE" || category === "INTERES_COMERCIAL";
    });
    const crmSale = events.find((event) => event.confirmedSale || classifyRecyclingTipification(event.tipificationOriginal) === "VENTA_CRM_NO_CONFIRMADA");
    let decision: RecyclingDecisionRecord;
    if (original.mobile && globallyBlockedMobiles.has(original.mobile)) {
      decision = { originalRecordId: original.id, decision: "BLOQUEADO_VENTA", reason: "Venta confirmada en registro comercial externo", winningManagementId: null };
    } else if (opposition) {
      decision = { originalRecordId: original.id, decision: "REVISION_CONFLICTO", reason: "Oposición al contacto documentada; supresión comercial prioritaria", winningManagementId: opposition.id };
    } else if (original.mobile && activelyReservedMobiles.has(original.mobile)) {
      decision = { originalRecordId: original.id, decision: "REVISION_CONFLICTO", reason: "Reserva comercial activa; requiere liberación explícita antes de reciclar", winningManagementId: null };
    } else if (pending) {
      decision = { originalRecordId: original.id, decision: "REVISION_GESTION", reason: "Seguimiento o interés comercial pendiente de resolución explícita", winningManagementId: pending.id };
    } else if (crmSale) {
      decision = { originalRecordId: original.id, decision: "REVISION_CONFLICTO", reason: "Venta indicada en CRM sin confirmación en Ventas", winningManagementId: crmSale.id };
    } else {
      const ambiguousSale = events.find((event) => event.saleAmbiguous);
      const winner = newestManagement(events);
      const portability = original.portabilityDate ? day(original.portabilityDate) : null;
      if (ambiguousSale) {
        decision = { originalRecordId: original.id, decision: "REVISION_CONFLICTO", reason: "Dato de venta ambiguo; requiere revisión humana", winningManagementId: ambiguousSale.id };
      } else if (!winner.event) {
        decision = { originalRecordId: original.id, decision: "REVISION_GESTION", reason: "Sin gestión CRM con fecha válida", winningManagementId: null };
      } else if (winner.conflict) {
        decision = { originalRecordId: original.id, decision: "REVISION_CONFLICTO", reason: "Tipificaciones contradictorias en la misma fecha", winningManagementId: winner.event.id };
      } else if (classifyRecyclingTipification(winner.event.tipificationOriginal) === "RECHAZO_COMERCIAL") {
        decision = { originalRecordId: original.id, decision: "REVISION_GESTION", reason: "Rechazo comercial; no se recicla automáticamente", winningManagementId: winner.event.id };
      } else if (classifyRecyclingTipification(winner.event.tipificationOriginal) === "DATOS_INCORRECTOS") {
        decision = { originalRecordId: original.id, decision: "REVISION_GESTION", reason: "Datos de contacto o titularidad requieren revisión", winningManagementId: winner.event.id };
      } else if (!allowed.has(normalizeRecyclingTipification(winner.event.tipificationOriginal))) {
        decision = { originalRecordId: original.id, decision: "REVISION_GESTION", reason: "Tipificación no seleccionada o no reconocida", winningManagementId: winner.event.id };
      } else if (!portability) {
        decision = { originalRecordId: original.id, decision: "REVISION_PERMANENCIA", reason: "Fecha de portabilidad ausente o inválida", winningManagementId: winner.event.id };
      } else if (portability.getTime() < minimum.getTime()) {
        decision = { originalRecordId: original.id, decision: "FUERA_RANGO_HISTORICO", reason: "Fecha de portabilidad anterior al mínimo histórico", winningManagementId: winner.event.id };
      } else if (completedCalendarMonths(portability, effective) < criteria.minimumMonths) {
        decision = { originalRecordId: original.id, decision: "REVISION_PERMANENCIA", reason: "No cumple la permanencia mínima en la fecha efectiva", winningManagementId: winner.event.id };
      } else {
        decision = { originalRecordId: original.id, decision: "ELEGIBLE", reason: "Tipificación seleccionada y permanencia cumplida", winningManagementId: winner.event.id };
      }
    }
    summary[decision.decision] += 1;
    decisions.push(decision);
  }
  return { decisions, incidentsOutsideBase, summary };
}
