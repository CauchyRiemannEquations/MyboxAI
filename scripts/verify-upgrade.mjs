import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import * as CFB from "cfb";
import { zipSync, strToU8, deflateSync } from "fflate";
const require = createRequire(import.meta.url), wr = createRequire(require.resolve("wrangler/package.json"));
const { build } = wr("esbuild"), { Miniflare } = wr("miniflare");
await mkdir(".sites-runtime", { recursive: true });
const exports = 'export * from "./lib/mybox/range-extract"; export * from "./lib/mybox/source"; export * from "./lib/mybox/ocr"; export * from "./lib/mybox/client"; export * from "./lib/mybox/read"; export * from "./lib/mybox/credentials";';
await build({ stdin: { contents: exports, resolveDir: process.cwd(), loader: "ts" }, bundle: true, packages: "external", platform: "node", format: "esm", outfile: ".sites-runtime/upgrade-core.mjs" });
const core = await import(path.resolve(".sites-runtime/upgrade-core.mjs"));
let checks = 0;
async function check(name, task) { await task(); checks++; console.log(`PASS ${name}`); }
function source(data) { return { size: data.length, readBytes: 0, async read(offset, length) { this.readBytes += length; assert(offset >= 0 && offset + length <= data.length); return data.slice(offset, offset + length); } }; }
function makePDF(blank = false, padding = 0) {
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Resources << /Font << /F1 5 0 R >> >> /Contents 7 0 R >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  for (const text of ["Hello derivative problem 123", "Second page 456"]) { const stream = (blank === true || (blank === "mixed" && text.includes("Second"))) ? "" : `BT /F1 12 Tf 30 240 Td (${text}) Tj ET`; objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`); }
  let prefix = "%PDF-1.4\n"; const positions = [0]; objects.forEach((v, i) => { positions.push(prefix.length); prefix += `${i + 1} 0 obj\n${v}\nendobj\n`; });
  if (padding) { positions.push(prefix.length); prefix += `8 0 obj\n<< /Length ${padding} >>\nstream\n`; }
  const endStream = padding ? "\nendstream\nendobj\n" : "";
  const xref = prefix.length + padding + endStream.length;
  let suffix = `${endStream}xref\n0 ${positions.length}\n0000000000 65535 f \n`;
  for (const p of positions.slice(1)) suffix += `${String(p).padStart(10, "0")} 00000 n \n`;
  suffix += `trailer\n<< /Size ${positions.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return { prefix, suffix, padding, size: prefix.length + padding + suffix.length };
}
const mixedParts = makePDF("mixed"), mixed = strToU8(mixedParts.prefix + mixedParts.suffix);
const pdfParts = makePDF(), pdf = strToU8(pdfParts.prefix + pdfParts.suffix), scanParts = makePDF(true), scan = strToU8(scanParts.prefix + scanParts.suffix);
await check("range PDF page selection, continuation and scan detection", async () => { const s = source(pdf); const first = await core.extractPdfRange(s, 1, 1); assert(first.text.includes("Hello derivative")); assert.equal(first.nextStartPage, 2); assert.equal(first.totalPages, 2); const blank = await core.extractPdfRange(source(scan), 1, 2); assert(blank.pages.every(p => p.needsOcr)); });
const huge = zipSync({ "word/document.xml": strToU8('<w:document><w:p><w:t>한글 수학 자료</w:t></w:p></w:document>'), "word/media/large.png": new Uint8Array(35 * 1024 * 1024).fill(57) }, { level: 0 });
await check("35MB DOCX skips image payload and reads only body XML", async () => { const s = source(huge); assert.equal((await core.extractZipRange(s, "docx")).text, "한글 수학 자료"); assert(s.readBytes < 100000); });
await check("HWPX equation script and bounded ZIP expansion", async () => { const zip = zipSync({ "Contents/section0.xml": strToU8('<hp:section><hp:p><hp:t>접선</hp:t><hp:script>x^2</hp:script></hp:p></hp:section>') }); const text = (await core.extractZipRange(source(zip), "hwpx")).text; assert(text.includes("x^2")); const bomb = zipSync({ "word/document.xml": strToU8("a".repeat(8 * 1024 * 1024 + 1)) }); await assert.rejects(core.extractZipRange(source(bomb), "docx"), e => e.code === "TOO_COMPLEX"); });
function makeHWP(compressed, imageBytes = 0) { const text = Buffer.from("한글 미분 원문\r", "utf16le"), record = Buffer.alloc(4 + text.length); record.writeUInt32LE((text.length << 20) | 67); text.copy(record, 4); const header = Buffer.alloc(256); header.write("HWP Document File"); header.writeUInt32LE(compressed ? 1 : 0, 36); const doc = CFB.utils.cfb_new(); CFB.utils.cfb_add(doc, "FileHeader", header); CFB.utils.cfb_add(doc, "BodyText/Section0", compressed ? deflateSync(record) : record); if (imageBytes) CFB.utils.cfb_add(doc, "BinData/BIN0001.png", Buffer.alloc(imageBytes, 42)); return new Uint8Array(CFB.write(doc, { type: "array" })); }
await check("30MB HWP skips BinData, compressed and mini streams parse correctly", async () => { for (const compressed of [true, false]) { const s = source(makeHWP(compressed, compressed ? 30 * 1024 * 1024 : 0)); assert.equal((await core.extractHwpRange(s)).text, "한글 미분 원문"); assert(s.readBytes < 1024 * 1024); } });
await check("large UTF-8 text continues across multibyte boundary", async () => { const data = strToU8("가나다 abc\n".repeat(180000)), s = source(data); const first = await core.extractTextRange(s, "txt"); const second = await core.extractTextRange(s, "txt", first.nextStartByte); assert.equal(first.text + second.text, new TextDecoder().decode(data.subarray(0, second.nextStartByte))); assert(!first.text.includes("�") && !second.text.includes("�")); });
await check("UTF-16 continuation preserves a split surrogate pair", async () => { const value = "a".repeat(262142) + "😀" + " 수학 자료".repeat(1000), data = new Uint8Array(Buffer.concat([Buffer.from([255,254]), Buffer.from(value,"utf16le")])), s=source(data); const first=await core.extractTextRange(s,"txt"), second=await core.extractTextRange(s,"txt",first.nextStartByte); assert.equal(first.text+second.text,value); });
await check("public format limits and no-key OCR configuration", async () => { assert.equal(core.fileLimit("math.pdf"), 100 * 1024 * 1024); assert.equal(core.fileLimit("math.hwp"), 50 * 1024 * 1024); assert.equal(core.fileLimit("photo.png"), 20 * 1024 * 1024); });

// Exercise the upgraded source, OCR accounting and encryption in the deployed runtime.
const key = Buffer.alloc(32, 13).toString("base64");
await writeFile(".sites-runtime/large-pdf-parts.json", JSON.stringify(makePDF(false, 80 * 1024 * 1024)));
const worker = `
import {MyboxClient} from "./lib/mybox/client";
import {stageDocument,R2Source} from "./lib/mybox/source";
import {extractPdfRange,extractZipRange,extractHwpRange} from "./lib/mybox/range-extract";
import {saveOcrSettings,ocrStatus,ocrPages,reserveOcrPages,removeOcr} from "./lib/mybox/ocr";
import {readMyboxFile} from "./lib/mybox/read";
import {safeError} from "./lib/mybox/errors";
import large from "./.sites-runtime/large-pdf-parts.json";
const PAT="mbx_pat_test_1234567890", OCR_KEY="mistral_mock_api_key_123456";
let calls=0, fail=false, captured=null;
const provider=async (url,init)=>{ if(String(url).endsWith("/models")) return Response.json({data:[{id:"mistral-ocr-4-1"}]}); calls++; captured=JSON.parse(init.body); if(fail) return new Response("secret diagnostics",{status:500}); return Response.json({pages:captured.pages.map(i=>({index:i,markdown:"수학 OCR 원문 $x^2$ 쪽 "+i}))}); };
function client(meta,bytes){return new MyboxClient(PAT,async (url,init)=>{const u=new URL(url); if(u.hostname.startsWith("storage")){ if(init.headers?.Authorization) throw Error("PAT leaked"); return new Response(bytes,{headers:{"content-length":String(meta.size)}}); } if(u.pathname.endsWith("/download")) return Response.json({downloadUrl:"https://storage.mybox.naver.com/test?signed=1"}); return Response.json(meta);});}
const meta={resourceId:"scan1",name:"scan.pdf",size:100,type:"file",modifiedAt:"2026-10-05T00:00:00Z"};
export default { async fetch(request,env){ const u=new URL(request.url); try {
 if(u.pathname==="/setup"){await saveOcrSettings(env,"alice",OCR_KEY,3,true,provider);return Response.json(await ocrStatus(env,"alice"));}
 if(u.pathname==="/ocr"){const who=u.searchParams.get("user")||"alice", pages=(u.searchParams.get("pages")||"1").split(",").map(Number); fail=u.searchParams.get("fail")==="1"; const r=await ocrPages(env,who,client(meta),meta,pages,false,provider);return Response.json({...r,pages:[...r.pages],calls,captured,status:await ocrStatus(env,who)});}
 if(u.pathname==="/reserve"){await saveOcrSettings(env,"race",OCR_KEY,3,true,provider);const r=await Promise.allSettled([reserveOcrPages(env,"race",2,3),reserveOcrPages(env,"race",2,3)]);return Response.json({fulfilled:r.filter(x=>x.status==="fulfilled").length,status:await ocrStatus(env,"race")});}
 if(u.pathname==="/read"){const bytes=new Uint8Array(await request.arrayBuffer()), r=await readMyboxFile(client({...meta,size:bytes.length,name:"native.pdf"},bytes),env,"alice","https://mybox.example",{id:meta.resourceId,ocr:"never",page_count:1});return Response.json(r);}
 if(u.pathname==="/auto"){await saveOcrSettings(env,"auto",OCR_KEY,50,true,provider); fail=false; const bytes=new Uint8Array(await request.arrayBuffer()),m={...meta,name:"auto.pdf",size:bytes.length};const r=await readMyboxFile(client(m,bytes),env,"auto","https://mybox.example",{id:meta.resourceId,page_count:2},provider);return Response.json(r);}
 if(u.pathname==="/limit"){const r=await readMyboxFile(client({...meta,size:101*1024*1024}),env,"alice","https://mybox.example",{id:meta.resourceId});return Response.json(r);}
 if(u.pathname==="/consent"){await saveOcrSettings(env,"new",OCR_KEY,50,false,provider);return Response.json({saved:true});}
 if(u.pathname==="/large"){const p=new TextEncoder().encode(large.prefix),s=new TextEncoder().encode(large.suffix);let position=-1;const stream=new ReadableStream({pull(controller){if(position===-1){controller.enqueue(p);position=0;}else if(position<large.padding){const length=Math.min(64*1024,large.padding-position);controller.enqueue(new Uint8Array(length).fill(32));position+=length;}else{controller.enqueue(s);controller.close();}}});const m={...meta,name:"large.pdf",size:large.size};const staged=await stageDocument(client(m,stream),env.BUCKET,m.resourceId,m);let r;try{r=await extractPdfRange(staged.source,1,1);r.read_bytes=staged.source.readBytes;}finally{await staged.dispose();}return Response.json({...r,file_size:large.size,objects:(await env.BUCKET.list()).objects.length});}
 if(u.pathname==="/range"){const kind=u.searchParams.get("kind"),data=new Uint8Array(await request.arrayBuffer());await env.BUCKET.put("fixture",data);const src=new R2Source(env.BUCKET,"fixture",data.length);try{return Response.json(kind==="hwp"?await extractHwpRange(src):await extractZipRange(src,kind));}finally{await env.BUCKET.delete("fixture");}}
 if(u.pathname==="/remove"){await removeOcr(env,"alice");return Response.json(await ocrStatus(env,"alice"));}
 return new Response("Not found",{status:404});
 }catch(error){const e=safeError(error);return Response.json({error:e.code,message:e.message,calls},{status:e.status});} } };
`;
await build({ stdin: { contents: worker, resolveDir: process.cwd(), loader: "ts" }, bundle: true, platform: "browser", format: "esm", target: "es2022", external: ["node:*"], outfile: ".sites-runtime/upgrade-worker.mjs" });
const mf = new Miniflare({ modules: true, scriptPath: path.resolve(".sites-runtime/upgrade-worker.mjs"), compatibilityDate: "2026-05-15", compatibilityFlags: ["nodejs_compat"], bindings: { MYBOX_TOKEN_ENCRYPTION_KEY: key }, d1Databases: ["DB"], r2Buckets: ["BUCKET"] });
const call = (route, init) => mf.dispatchFetch("https://mybox.example" + route, init);
try {
  const db = await mf.getD1Database("DB");
  for (const file of (await readdir("drizzle")).filter(f => f.endsWith(".sql")).sort()) for (const sql of (await readFile("drizzle/" + file, "utf8")).split("--> statement-breakpoint").filter(s => s.trim())) await db.prepare(sql).run();
  await check("runtime OCR key encrypted, status sanitized and quota configured", async () => { const r = await (await call("/setup")).json(); assert(r.enabled); assert.equal(r.daily_limit,3); const setting=await db.prepare("SELECT encrypted_key FROM ocr_settings WHERE user_id = ?").bind("alice").first(); assert(!setting.encrypted_key.includes("mistral_mock_api_key")); });
  await check("runtime OCR only selected pages, cache reuse and user isolation", async () => { const first=await (await call("/ocr?pages=1,2")).json(); assert.equal(first.processedPages,2); assert.deepEqual(first.captured.pages,[0,1]); assert.equal(first.captured.model,core.OCR_MODEL); assert(!JSON.stringify(first.captured).includes("mbx_pat_")); assert(first.pages[0][1].includes("$x^2$")); const second=await (await call("/ocr?pages=1,2")).json(); assert.equal(second.cacheHits,2); assert.equal(second.calls,1); assert.equal(second.status.pages_today,2); const foreign=await call("/ocr?user=bob"); assert.equal(foreign.status,409); const cached=await db.prepare("SELECT encrypted_text FROM ocr_cache WHERE user_id = ? LIMIT 1").bind("alice").first(); assert(!cached.encrypted_text.includes("수학")); });
  await check("runtime quota rejects excessive and concurrent paid OCR attempts", async () => { const rejected=await call("/ocr?pages=3,4"); assert.equal(rejected.status,429); const data=await rejected.json(); assert.equal(data.calls,1); const race=await(await call("/reserve")).json(); assert.equal(race.fulfilled,1); assert.equal(race.status.pages_today,2); });
  await check("runtime OCR failures sanitized, counted, no automatic paid retry", async () => { const r=await call("/ocr?pages=3&fail=1"); assert.equal(r.status,502); const e=await r.json(); assert(!JSON.stringify(e).includes("secret diagnostics")); assert.equal(e.calls,2); const next=await call("/ocr?pages=3"); assert.equal(next.status,429); });
  await check("runtime native PDF read skips OCR; private staging removed", async () => { const r=await call("/read",{method:"POST",body:pdf}); const text=await r.text(); assert.equal(r.status,200,text); const data=JSON.parse(text); assert(data.text.includes("Hello derivative")); assert.equal(data.metadata.ocr_processed_pages,0); assert.equal((await (await mf.getR2Bucket("BUCKET")).list()).objects.length,0); });
  await check("runtime 80MB PDF streamed to R2 and parsed using small ranges", async () => { const r=await call("/large"); const text=await r.text(); assert.equal(r.status,200,text); const data=JSON.parse(text); assert(data.file_size>80*1024*1024); assert(data.read_bytes<1024*1024); assert(data.text.includes("Hello derivative")); assert.equal(data.objects,0); });
  await check("runtime mixed PDF auto OCR keeps native page and processes only scan", async () => { const r=await call("/auto",{method:"POST",body:mixed}); const text=await r.text(); assert.equal(r.status,200,text); const data=JSON.parse(text); assert(data.text.includes("Hello derivative problem")); assert(data.text.includes("수학 OCR")); assert.deepEqual(data.metadata.ocr_pages,[2]); assert.equal(data.metadata.ocr_processed_pages,1); const again=await(await call("/auto",{method:"POST",body:mixed})).json(); assert.equal(again.metadata.ocr_cache_hits,1); assert.equal(again.metadata.ocr_processed_pages,0); });
  await check("runtime rejects oversized files and missing OCR consent", async () => { assert.equal((await call("/limit")).status,413); assert.equal((await call("/consent")).status,400); });
  await check("runtime range HWP and DOCX parsers", async () => { for(const [kind,data] of [["hwp",makeHWP(true)],["docx",zipSync({"word/document.xml":strToU8('<w:document><w:p><w:t>검증 원문</w:t></w:p></w:document>')})]]) { const r=await call("/range?kind="+kind,{method:"POST",body:data}); const text=await r.text(); assert.equal(r.status,200,text); assert(JSON.parse(text).text.includes(kind==="hwp"?"미분":"검증")); } });
  await check("runtime disconnect deletes OCR key and cached document text", async () => { const r=await(await call("/remove")).json(); assert(!r.enabled); assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM ocr_cache WHERE user_id = ?").bind("alice").first()).n,0); });
} finally { await mf.dispose(); }
console.log(`Verified ${checks} upgrade checks.`);
