import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRecyclingFiles, recyclingToBatch } from "../lib/recycling/recycling.ts";
import { buildCampaignReport } from "../lib/campaigns/campaign-engine.ts";
import { buildExportPlan } from "../lib/export/xlsx-export.ts";

const headers = ["Fecha", "Telefono Movil", "Tipificacion", "Usado"];
test("consolida por móvil sin excluir USADO/SI y mantiene la procedencia de cada gestión", () => {
 const analysis = analyzeRecyclingFiles([{ fileName:"a.xlsx", sheetName:"Datos", columns:headers,rows:[["2026-01-01","612345678","NO RESPONDE","SI"],["2026-01-02","612345678","AGENDADO","NO"]]}, {fileName:"b.xlsx", sheetName:"Datos", columns:headers,rows:[["2026-01-03","712345678","BUZON DE VOZ",""]]}]);
 assert.equal(analysis.counts.duplicados,1); assert.equal(analysis.winners.find(r=>r.mobile==="612345678")?.bucket,"seguimiento"); assert.equal(analysis.winners.find(r=>r.mobile==="712345678")?.bucket,"candidato");
 assert.equal(new Set(analysis.records.map((record) => record.sourceRow)).size, 3);
 assert.deepEqual(analysis.records.map((record) => [record.fileName, record.sheetName, record.originRow]), [["a.xlsx", "Datos", 2], ["a.xlsx", "Datos", 3], ["b.xlsx", "Datos", 2]]);
});
test("prioriza bloqueos, conserva desconocidos en revisión y crea lotes exportables de 100", () => {
 const blockHeaders=[...headers,"Bloqueado"]; const rows=Array.from({length:101},(_,i)=>["2026-01-01",`6${String(i).padStart(8,"0")}`,"NO RESPONDE","",""]); rows.push(["2026-01-03","612345678","NO RESPONDE","","BLOQUEADO"]);
 const analysis=analyzeRecyclingFiles([{fileName:"a.xlsx",columns:blockHeaders,rows:[...rows,["2026-01-04","712345678","OTRA","",""]]}]);
 assert.equal(analysis.winners.find(r=>r.mobile==="612345678")?.bucket,"bloqueado"); assert.equal(analysis.winners.find(r=>r.mobile==="712345678")?.bucket,"revision");
 const selected=new Set(["NO RESPONDE"]); const batch=recyclingToBatch(analysis,selected); assert.equal(batch.enrichmentOutput?.rows.length,101); assert.equal(batch.dataset.records.length,101); assert.equal(batch.recyclingHistory?.records.length,2); assert.equal(batch.provenanceBySourceRow[2],"CRM");
});

test("el batch reciclado opera solo sobre seleccionados y sus lotes no incluyen historial", () => {
 const analysis=analyzeRecyclingFiles([{fileName:"a.xlsx",columns:["Fecha","Telefono Movil","Tipificacion","Operador Actual"],rows:[["2026-01-01","612345678","NO RESPONDE","Movistar"],["2026-01-02","712345678","AGENDADO","Vodafone"],["2026-01-03","622345678","OTRA","Orange"]]}]);
 const batch=recyclingToBatch(analysis,new Set(["NO RESPONDE"]));
 assert.equal(batch.kind,"RECICLADA"); assert.equal(batch.dataset.records.length,1); assert.equal(batch.recyclingHistory?.records.length,2);
 const report=buildCampaignReport(batch.enrichmentOutput!, ["yoigo","vodafone"]); const plan=buildExportPlan(report,["yoigo","vodafone"],100);
 assert.deepEqual(plan.campaigns.map(c=>[c.campaign,c.eligibleCount]),[["yoigo",1],["vodafone",1]]);
 assert.ok(plan.campaigns.flatMap(c=>c.batches.flatMap(b=>b.rows)).every(row=>row.sourceRow===batch.dataset.records[0]?.sourceRow));
});

test("cambiar selección o importar otro conjunto genera un batch aislado", () => {
 const first=analyzeRecyclingFiles([{fileName:"uno.xlsx",columns:headers,rows:[["2026-01-01","612345678","NO RESPONDE",""]]}]);
 const second=analyzeRecyclingFiles([{fileName:"dos.xlsx",columns:headers,rows:[["2026-01-01","712345678","BUZON DE VOZ",""]]}]);
 const firstBatch=recyclingToBatch(first,new Set(["NO RESPONDE"])); const withoutCandidates=recyclingToBatch(first,new Set()); const secondBatch=recyclingToBatch(second,new Set(["BUZON DE VOZ"]));
 assert.notEqual(firstBatch.id,secondBatch.id); assert.equal(withoutCandidates.dataset.records.length,0); assert.deepEqual(secondBatch.dataset.records.map(record=>record.mobile),["712345678"]); assert.ok(!secondBatch.recyclingHistory?.records.some(record=>record.mobile==="612345678"));
});
