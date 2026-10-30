export interface HistoricalBaseSummary {
  id: string;
  code: string;
  name: string;
  originalFileName: string;
  receivedAt: string | null;
  state: string;
  kind: "ORIGINAL" | "RECICLADA";
  imported: number;
  valid: number;
  excluded: number;
}

export interface HistoricalBaseFilters {
  query?: string;
  kind?: "all" | HistoricalBaseSummary["kind"];
  state?: "all" | string;
  fromDate?: string;
  toDate?: string;
}

export function formatBaseCode(receivedAt: Date, sequence: number): string {
  if (!Number.isInteger(sequence) || sequence < 1) throw new Error("La secuencia de código debe ser positiva.");
  const period = `${receivedAt.getUTCFullYear()}-${String(receivedAt.getUTCMonth() + 1).padStart(2, "0")}`;
  return `BAS-${period}-${String(sequence).padStart(4, "0")}`;
}

export function filterHistoricalBases(bases: readonly HistoricalBaseSummary[], filters: HistoricalBaseFilters): HistoricalBaseSummary[] {
  const query = filters.query?.trim().toLocaleLowerCase("es-ES") ?? "";
  return bases.filter((base) => {
    const receivedAt = base.receivedAt ?? "";
    return (filters.kind === undefined || filters.kind === "all" || base.kind === filters.kind)
      && (filters.state === undefined || filters.state === "all" || base.state === filters.state)
      && (!filters.fromDate || receivedAt >= filters.fromDate)
      && (!filters.toDate || receivedAt <= filters.toDate)
      && (!query || `${base.code} ${base.name} ${base.originalFileName} ${base.state} ${base.kind}`.toLocaleLowerCase("es-ES").includes(query));
  });
}
