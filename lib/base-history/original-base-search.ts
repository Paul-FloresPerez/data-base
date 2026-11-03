export function normalizeOriginalBaseSearch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es-ES")
    .replace(/\s+/g, " ")
    .trim();
}

export type OriginalBaseOption = {
  id: string;
  code: string;
  name: string;
  originalFileName: string;
  receivedAt: string | null;
  imported: number;
  state: string;
  kind: "ORIGINAL";
};
