export type FirstRealSozarUiSaveState = "error" | "saved" | "saving" | "unsaved";

export type FirstRealSozarUiReadinessInput = {
  uiGateEnabled: boolean;
  isInEnrichment: boolean;
  hasPreview: boolean;
  saveState: FirstRealSozarUiSaveState;
  serverReady: boolean;
  serverIssue: string | null;
  globalStatus: string | null;
  hasPreparedSingleSelection: boolean;
  hasExplicitConfirmation: boolean;
  isExecuting: boolean;
};

export type FirstRealSozarUiReadiness = {
  canExecute: boolean;
  reason: string | null;
};

/**
 * The browser must never turn a locally prepared queue into authorization. This
 * explains every prerequisite while the server remains authoritative for the
 * original-base check and the durable global one-shot reservation.
 */
export function getFirstRealSozarUiReadiness(input: FirstRealSozarUiReadinessInput): FirstRealSozarUiReadiness {
  if (!input.uiGateEnabled) return { canExecute: false, reason: "La prueba única de Sozar permanece bloqueada por código." };
  if (!input.isInEnrichment || !input.hasPreview) return { canExecute: false, reason: "Abre Enriquecer base con una limpieza válida antes de preparar la prueba." };
  if (input.saveState === "saving") return { canExecute: false, reason: "La base se está guardando. Espera a que el guardado termine correctamente antes de ejecutar la prueba única." };
  if (input.saveState !== "saved") return { canExecute: false, reason: "Guarda la base ORIGINAL y confirma que finalizó correctamente antes de ejecutar la prueba única." };
  if (input.serverIssue) return { canExecute: false, reason: input.serverIssue };
  if (!input.serverReady) return { canExecute: false, reason: "No se pudo verificar la configuración segura de la prueba única. Reintenta sin preparar otra consulta." };
  if (input.globalStatus && input.globalStatus !== "SIN_PRUEBA_REAL") return { canExecute: false, reason: `La única prueba real ya tiene estado ${input.globalStatus} y no puede reutilizarse.` };
  if (!input.hasPreparedSingleSelection) return { canExecute: false, reason: "Selecciona y prepara exactamente un móvil; la opción Todos no autoriza la prueba única." };
  if (!input.hasExplicitConfirmation) return { canExecute: false, reason: "Confirma la autorización y el posible cargo antes de ejecutar la prueba única." };
  if (input.isExecuting) return { canExecute: false, reason: "La solicitud única está en curso; no se enviará un reintento automático." };
  return { canExecute: true, reason: null };
}
