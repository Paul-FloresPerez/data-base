import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRecyclingFiles, recyclingToBatch } from "../lib/recycling/recycling.ts";

const headers = ["Fecha", "Telefono Movil", "Tipificacion", "Usado"];
test("consolida duplicados por fecha sin excluir USADO/SI", () => {
 const analysis = analyzeRecyclingFiles([{ fileName:"a.xlsx",columns:headers,rows:[["2026-01-01","612345678","NO RESPONDE","SI"],["2026-01-02","612345678","AGENDADO","NO"]]}, {fileName:"b.xlsx",columns:headers,rows:[["2026-01-03","712345678","BUZON DE VOZ",""]]}]);
 assert.equal(analysis.counts.duplicados,1); assert.equal(analysis.winners.find(r=>r.mobile==="612345678")?.bucket,"seguimiento"); assert.equal(analysis.winners.find(r=>r.mobile==="712345678")?.bucket,"candidato");
});
test("prioriza bloqueos, conserva desconocidos en revisión y crea lotes exportables de 100", () => {
 const blockHeaders=[...headers,"Bloqueado"]; const rows=Array.from({length:101},(_,i)=>["2026-01-01",`6${String(i).padStart(8,"0")}`,"NO RESPONDE","",""]); rows.push(["2026-01-03","612345678","NO RESPONDE","","BLOQUEADO"]);
 const analysis=analyzeRecyclingFiles([{fileName:"a.xlsx",columns:blockHeaders,rows:[...rows,["2026-01-04","712345678","OTRA","",""]]}]);
 assert.equal(analysis.winners.find(r=>r.mobile==="612345678")?.bucket,"bloqueado"); assert.equal(analysis.winners.find(r=>r.mobile==="712345678")?.bucket,"revision");
 const approved=new Set(analysis.winners.filter(r=>r.bucket==="candidato").map(r=>r.mobile)); assert.equal(recyclingToBatch(analysis,approved).enrichmentOutput?.rows.length,101);
});
