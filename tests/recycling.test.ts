import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRecyclingFiles, recyclingToBatch } from "../lib/recycling/recycling.ts";
import { buildCampaignReport } from "../lib/campaigns/campaign-engine.ts";
import { buildExportPlan } from "../lib/export/xlsx-export.ts";
import { extractArchiveWorkbooks, fingerprintBytes, isSafeArchivePath, isSupportedWorkbookPath } from "../lib/recycling/archive-import.ts";
import JSZip from "jszip";

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

test("conserva ZIP y ruta interna sin colisionar filas de origen", () => {
 const analysis=analyzeRecyclingFiles([{fileName:"uno.xlsx",zipName:"crm.zip",internalPath:"enero/uno.xlsx",columns:headers,rows:[["2026-01-01","612345678","NO RESPONDE",""]]}, {fileName:"dos.xlsx",zipName:"crm.zip",internalPath:"febrero/dos.xlsx",columns:headers,rows:[["2026-01-01","712345678","BUZON DE VOZ",""]]}]);
 assert.deepEqual(analysis.records.map((record)=>[record.sourceRow,record.originRow,record.zipName,record.internalPath]),[[2,2,"crm.zip","enero/uno.xlsx"],[3,2,"crm.zip","febrero/dos.xlsx"]]);
 const batch=recyclingToBatch(analysis,new Set(["NO RESPONDE","BUZON DE VOZ"]));
 assert.equal(batch.dataset.columns.includes("ZIP origen"),true);
 assert.equal(batch.dataset.records[0]?.cells.at(-9),"crm.zip");
});

test("extrae XLSX anidados, omite temporales y aplica límites de archivo", async () => {
 const zip=new JSZip();
 zip.file("lote/a.xlsx",new Uint8Array([1,2,3]));
 zip.file("lote/~$a.xlsx",new Uint8Array([1,2,3]));
 zip.file(".oculto.xlsx",new Uint8Array([1,2,3]));
 zip.file("lote/notas.txt","no importar");
 const bytes=await zip.generateAsync({type:"arraybuffer"});
 const extracted=await extractArchiveWorkbooks("crm.zip",bytes);
 assert.equal(extracted.workbooks.length,1);
 assert.deepEqual(extracted.workbooks[0] && [extracted.workbooks[0].zipName,extracted.workbooks[0].internalPath,extracted.workbooks[0].fileName],["crm.zip","lote/a.xlsx","a.xlsx"]);
 assert.equal(isSupportedWorkbookPath("carpeta/~$temp.xlsx"),false);
 assert.equal(isSafeArchivePath("../salida.xlsx"),false);
 const limited=await extractArchiveWorkbooks("crm.zip",bytes,{maxCompressedBytes:bytes.byteLength+1,maxUncompressedBytes:2,maxFiles:1,maxWorkbookBytes:2});
 assert.equal(limited.workbooks.length,0);
 assert.ok(limited.rejected.some((issue)=>issue.reason.includes("límites de seguridad")));
});

test("detecta ZIP vacío y duplicados de contenido de forma estable", async () => {
 const empty=new JSZip();
 empty.file("nota.txt","sin Excel");
 const emptyResult=await extractArchiveWorkbooks("vacio.zip",await empty.generateAsync({type:"arraybuffer"}));
 assert.equal(emptyResult.workbooks.length,0);
 assert.ok(emptyResult.rejected.some((issue)=>issue.reason.includes("no contiene")));
 const bytes=new Uint8Array([8,9,10]).buffer;
 assert.equal(await fingerprintBytes(bytes),await fingerprintBytes(bytes.slice(0)));
});

test("informa un ZIP corrupto sin impedir que otra fuente se procese", async () => {
 const corrupt=await extractArchiveWorkbooks("dañado.zip",new Uint8Array([1,2,3,4]).buffer);
 assert.equal(corrupt.workbooks.length,0);
 assert.ok(corrupt.rejected.some((issue)=>issue.reason.includes("corrupto")));
 const good=new JSZip(); good.file("datos.xlsx",new Uint8Array([4,5,6]));
 const valid=await extractArchiveWorkbooks("correcto.zip",await good.generateAsync({type:"arraybuffer"}));
 assert.equal(valid.workbooks.length,1);
});
