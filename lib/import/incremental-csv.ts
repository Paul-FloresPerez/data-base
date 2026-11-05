/**
 * Stateful CSV reader for durable workers. It receives byte chunks and emits
 * rows immediately; callers never need to retain the original file in memory.
 */
export type CsvDelimiter = "," | ";" | "\t";

export async function* streamCsvRows(chunks: AsyncIterable<Uint8Array>, delimiter: CsvDelimiter): AsyncGenerator<string[]> {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let field = "";
  let row: string[] = [];
  let quoted = false;
  let quotePending = false;
  let skipLf = false;
  let first = true;

  const finishRow = () => {
    row.push(field);
    const completed = row;
    row = [];
    field = "";
    return completed;
  };

  for await (const bytes of chunks) {
    const text = decoder.decode(bytes, { stream: true });
    for (const rawChar of text) {
      const char = first && rawChar === "\uFEFF" ? "" : rawChar;
      first = false;
      if (skipLf) { skipLf = false; if (char === "\n") continue; }
      if (quoted) {
        if (quotePending) {
          if (char === '"') { field += '"'; quotePending = false; continue; }
          quoted = false;
          quotePending = false;
        } else if (char === '"') { quotePending = true; continue; }
        else { field += char; continue; }
      }
      if (char === '"' && field.length === 0) { quoted = true; continue; }
      if (char === delimiter) { row.push(field); field = ""; continue; }
      if (char === "\n" || char === "\r") {
        if (char === "\r") skipLf = true;
        yield finishRow();
        continue;
      }
      field += char;
    }
  }
  const tail = decoder.decode();
  if (tail) field += tail;
  if (quoted && !quotePending) throw new Error("El CSV contiene una celda entrecomillada sin cierre.");
  if (quotePending) quoted = false;
  if (field.length || row.length) yield finishRow();
}

export function alignCsvCells(cells: readonly string[], columns: number) {
  return Array.from({ length: columns }, (_, index) => cells[index] ?? "");
}
