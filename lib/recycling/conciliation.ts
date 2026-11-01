import { normalizeSpanishMobile, spanishMobileExclusionReason } from "../excel/cleaning.ts";

export type ConciliationRow = { fileId: string; fileName: string; sourceRow: number; mobile: string };
export type ConciliationIncident = { fileId: string; fileName: string; sourceRow: number; reason: "MOVIL_INVALIDO" | "MOVIL_NO_ENCONTRADO" | "MOVIL_REPETIDO" };
export type ConciliationFileSummary = {
  fileId: string;
  fileName: string;
  totalRows: number;
  invalidRows: number;
  uniqueValidMobiles: number;
  uniqueFoundMobiles: number;
  uniqueMissingMobiles: number;
  duplicateRows: number;
  mobilesWithMultipleManagements: number;
  incidents: ConciliationIncident[];
};
export type ConciliationSummary = {
  totalRows: number;
  invalidRows: number;
  uniqueValidMobiles: number;
  uniqueFoundMobiles: number;
  uniqueMissingMobiles: number;
  duplicateRows: number;
  mobilesWithMultipleManagements: number;
  files: ConciliationFileSummary[];
};

/** Server-independent, deterministic reconciliation used by the protected route. */
export function conciliateCrmRows(rows: readonly ConciliationRow[], originalMobiles: ReadonlySet<string>): ConciliationSummary {
  const byFile = new Map<string, ConciliationRow[]>();
  for (const row of rows) {
    const key = `${row.fileId}\u0000${row.fileName}`;
    const group = byFile.get(key) ?? [];
    group.push(row);
    byFile.set(key, group);
  }
  const files: ConciliationFileSummary[] = [];
  const globalValid = new Set<string>();
  const globalFound = new Set<string>();
  const globalMissing = new Set<string>();
  let invalidRows = 0;
  let duplicateRows = 0;
  let mobilesWithMultipleManagements = 0;
  for (const fileRows of byFile.values()) {
    const first = fileRows[0]!;
    const byMobile = new Map<string, number>();
    const valid = new Set<string>();
    const found = new Set<string>();
    const missing = new Set<string>();
    const incidents: ConciliationIncident[] = [];
    let fileInvalid = 0;
    let fileDuplicates = 0;
    for (const row of fileRows) {
      const failure = spanishMobileExclusionReason(row.mobile);
      if (failure) {
        fileInvalid += 1;
        incidents.push({ fileId: row.fileId, fileName: row.fileName, sourceRow: row.sourceRow, reason: "MOVIL_INVALIDO" });
        continue;
      }
      const mobile = normalizeSpanishMobile(row.mobile)!;
      const occurrences = (byMobile.get(mobile) ?? 0) + 1;
      byMobile.set(mobile, occurrences);
      if (occurrences > 1) {
        fileDuplicates += 1;
        incidents.push({ fileId: row.fileId, fileName: row.fileName, sourceRow: row.sourceRow, reason: "MOVIL_REPETIDO" });
      }
      valid.add(mobile);
      globalValid.add(mobile);
      if (originalMobiles.has(mobile)) {
        found.add(mobile);
        globalFound.add(mobile);
      } else {
        missing.add(mobile);
        globalMissing.add(mobile);
        if (occurrences === 1) incidents.push({ fileId: row.fileId, fileName: row.fileName, sourceRow: row.sourceRow, reason: "MOVIL_NO_ENCONTRADO" });
      }
    }
    const multiple = [...byMobile.values()].filter((count) => count > 1).length;
    invalidRows += fileInvalid;
    duplicateRows += fileDuplicates;
    mobilesWithMultipleManagements += multiple;
    files.push({ fileId: first.fileId, fileName: first.fileName, totalRows: fileRows.length, invalidRows: fileInvalid, uniqueValidMobiles: valid.size, uniqueFoundMobiles: found.size, uniqueMissingMobiles: missing.size, duplicateRows: fileDuplicates, mobilesWithMultipleManagements: multiple, incidents });
  }
  return { totalRows: rows.length, invalidRows, uniqueValidMobiles: globalValid.size, uniqueFoundMobiles: globalFound.size, uniqueMissingMobiles: globalMissing.size, duplicateRows, mobilesWithMultipleManagements, files };
}
