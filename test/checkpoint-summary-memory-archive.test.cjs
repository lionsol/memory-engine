"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const fs=require("node:fs"),os=require("node:os"),path=require("node:path"),{createHash}=require("node:crypto");
const archive=require("../lib/checkpoint/summary-memory-archive.cjs"),lab=require("../lib/checkpoint/summary-comparison-lab.cjs");
const {buildFactInput}=require("../lib/checkpoint/ordinary-summary-facts");
function fixture(){
 const rawLogs=[
  {entry_id:"original-conversation",source:"conversation",provenance:"session_flush",timestampMs:1792454400000,
   text:"\r\n**User:**  请检查部署时间。\r\n\r\n**Assistant:**\r\n**部署核对**\r\n\r\n原判断：mtime证明10:51部署。😀\r\n\r\n**User:**\r\nmtime可继承，不能证明启用时刻。\r\n\r\n**Assistant:**\r\n旧判断已撤回；实际启用时刻待加载日志。\r\n"},
  {entry_id:"qualification",source:"conversation",role:"assistant",text:"source=before_prompt_build；trigger=user；valid=true。"},
  {entry_id:"control",source:"conversation",role:"assistant",text:"HEARTBEAT_OK"},
  {entry_id:"empty",source:"conversation",text:"  "}
 ];
 const input=buildFactInput(rawLogs,"2026-10-20"),units=input.sources.flatMap(s=>s.units);
 const old=units.find(u=>u.text.includes("原判断")),current=units.find(u=>u.text.includes("旧判断已撤回")),qual=units.find(u=>u.text.includes("before_prompt_build"));
 const summary={version:lab.VERSION,target_date:input.target_date,binding:lab.buildPrompt(input,"direct").binding,
  items:[{topic:"部署核验",text:"部署时刻待核实。",evidence:[current.id],corrects:[old.id]},
   {topic:"自然样本",text:"报告称样本有效。",evidence:[qual.id],corrects:[]}]};
 const generator={model:"test-model",transport:"test",model_identity:"requested",prompt_sha256:"test-prompt"};
 return {rawLogs,input,summary,generator,targetDate:"2026-10-20",createdAt:"2026-10-29T00:00:00.000Z"};
}
const make=extra=>archive.createArchive({...fixture(),...extra});
const temp=()=>fs.mkdtempSync(path.join(os.tmpdir(),"checkpoint-memory-archive-"));
const resign=a=>{a.archive_id=createHash("sha256").update(JSON.stringify(a.payload)).digest("hex");return a;};
test("archive retains exact records including CRLF, turn labels, Unicode, metadata, unreferenced controls and empty input",()=>{
 const f=fixture(),a=archive.createArchive(f);
 assert.deepEqual(a.payload.raw_records,f.rawLogs);assert.deepEqual(a.payload.input,f.input);
 assert.equal(a.payload.raw_records[0].text,f.rawLogs[0].text);
 assert.equal(a.payload.raw_records[0].timestampMs,1792454400000);
 assert.equal(a.payload.raw_records[2].text,"HEARTBEAT_OK");assert.equal(a.payload.raw_records[3].text,"  ");
 assert.equal(a.payload.policy.kind,"derived_summary");assert.equal(a.payload.policy.lossy,true);
 f.rawLogs[0].text="changed";f.summary.items[0].text="changed";
 assert.ok(a.payload.raw_records[0].text.startsWith("\r\n"));assert.equal(a.payload.summary.items[0].text,"部署时刻待核实。");
});
test("segmented collection metadata survives JSON persistence instead of disappearing as an array property",()=>{
 const f=fixture();f.rawLogs.segmentedInput={targetDate:"2026-10-20",entries:[]};
 const a=archive.createArchive(f),d=temp();
 try{archive.persistArchive(d,a);assert.deepEqual(archive.loadArchive(d,a.archive_id).payload.segmented_input,f.rawLogs.segmentedInput);}
 finally{fs.rmSync(d,{recursive:true,force:true});}
});
test("lossy or known incorrect summaries are accepted as derived memory with nonblocking quality findings",()=>{
 const d=temp(),f=fixture();
 try{
  f.summary.items[0].text="目录mtime准确证明10:51启用；这个结论其实已撤回。";
  const a=archive.createArchive({...f,qualityFindings:["已知部署判断错误","样本资格只作概括"]});
  const r=archive.persistArchive(d,a),resolved=archive.resolveItem(d,a.archive_id,0);
  assert.equal(r.status,"TRACEABLE_DERIVED_MEMORY");assert.equal(r.semantic_correctness,"NOT_CERTIFIED");
  assert.equal(resolved.item.text,f.summary.items[0].text);
  assert.equal(resolved.policy.quality_findings_blocking,false);assert.equal(resolved.quality_findings.length,2);
  assert.ok(resolved.policy.source_required_for.includes("execution"));
 }finally{fs.rmSync(d,{recursive:true,force:true});}
});
test("persisted item resolves current and withdrawn quotes to exact archived record ranges and role attribution",()=>{
 const d=temp(),a=make();
 try{
  archive.persistArchive(d,a);const r=archive.resolveItem(d,a.archive_id,0);
  assert.equal(r.item_index,0);assert.equal(r.sources.length,2);
  for(const source of r.sources){
   const original=archive.readOriginalRecord(d,a.archive_id,source.locator.source_id);
   assert.equal(original.record.text.slice(source.locator.start,source.locator.end),source.quote);
   assert.equal(source.role,"assistant");assert.equal(source.entry_id,"original-conversation");
   assert.equal(original.source_hash,source.source_hash);assert.equal(source.locator.archive_id,a.archive_id);
  }
  assert.deepEqual(r.sources[0].referenced_as,["evidence"]);assert.deepEqual(r.sources[1].referenced_as,["corrects"]);
  const original=archive.readOriginalRecord(d,a.archive_id,"s0");
  assert.ok(original.record.text.includes("**User:**"));assert.ok(original.record.text.includes("😀"));
 }finally{fs.rmSync(d,{recursive:true,force:true});}
});
test("backtrace remains usable after original file is removed, and recovers omitted qualification values",()=>{
 const d=temp(),original=path.join(d,"live-source.md"),store=path.join(d,"archives"),f=fixture();
 try{
  fs.writeFileSync(original,f.rawLogs[1].text);f.rawLogs[1].original_path=original;
  const a=archive.createArchive(f);archive.persistArchive(store,a);fs.unlinkSync(original);
  const r=archive.resolveItem(store,a.archive_id,1),record=archive.readOriginalRecord(store,a.archive_id,"s1");
  assert.equal(fs.existsSync(original),false);
  for(const value of ["before_prompt_build","trigger=user","valid=true"]){
   assert.ok(!r.item.text.includes(value));assert.ok(r.sources.some(s=>s.quote.includes(value)));assert.ok(record.record.text.includes(value));
  }
 }finally{fs.rmSync(d,{recursive:true,force:true});}
});
test("source mutations, unknown citations and changed binding reject archive creation",()=>{
 for(const change of [f=>f.rawLogs[0].text+="changed",f=>f.summary.binding="wrong",
  f=>f.summary.items[0].evidence=["missing"],f=>f.summary.items[0].evidence=[]]){
  const f=fixture();change(f);assert.throws(()=>archive.createArchive(f));
 }
});
test("self-contained integrity verifies hashes, literal ranges, record maps and rendered body",()=>{
 for(const change of [
  a=>a.payload.raw_records[0].text+="corrupt",
  a=>a.payload.input.sources[0].units[0].start++,
  a=>a.payload.source_map[0].record_index=1,
  a=>a.payload.body+="corrupt",
  a=>a.payload.summary.items[0].evidence=["missing"],
  a=>a.payload.policy.semantic_correctness="CERTIFIED"
 ]){
  const a=make();change(a);resign(a);assert.throws(()=>archive.verifyArchive(a));
 }
 const a=make();a.payload.summary.items[0].text+="corrupt";
 assert.throws(()=>archive.verifyArchive(a),{code:"archive_integrity"});
});
test("immutable files are idempotent, corruption is rejected without overwrite, and each revision keeps its predecessor",()=>{
 const d=temp(),a=make();
 try{
  const first=archive.persistArchive(d,a),bytes=fs.readFileSync(first.path,"utf8");
  assert.equal(archive.persistArchive(d,a).archive_id,a.archive_id);assert.equal(fs.readFileSync(first.path,"utf8"),bytes);
  const f=fixture();f.summary.items[0].text="更正后的摘要版本，仍须回查原文。";
  const next=archive.createArchive({...f,previousArchiveId:a.archive_id,createdAt:"2026-10-29T01:00:00.000Z"});
  archive.persistArchive(d,next);assert.notEqual(next.archive_id,a.archive_id);
  assert.equal(archive.loadArchive(d,next.archive_id).payload.previous_archive_id,a.archive_id);
  assert.equal(fs.readFileSync(first.path,"utf8"),bytes);
  fs.writeFileSync(first.path,"corrupt");
  assert.throws(()=>archive.persistArchive(d,a));assert.equal(fs.readFileSync(first.path,"utf8"),"corrupt");
  assert.throws(()=>archive.resolveItem(d,a.archive_id,0));
 }finally{fs.rmSync(d,{recursive:true,force:true});}
});
test("a missing predecessor is not silently recorded as a usable revision",()=>{
 const d=temp(),a=make({previousArchiveId:"f".repeat(64)});
 try{assert.throws(()=>archive.persistArchive(d,a));assert.equal(fs.readdirSync(d).length,0);}
 finally{fs.rmSync(d,{recursive:true,force:true});}
});
test("failed atomic publication never returns acceptance or leaves a partially named archive",()=>{
 const d=temp(),a=make(),original=fs.linkSync;
 try{
  fs.linkSync=()=>{throw Object.assign(new Error("simulated IO failure"),{code:"EIO"});};
  assert.throws(()=>archive.persistArchive(d,a),{code:"EIO"});
  assert.equal(fs.readdirSync(d).length,0);
 }finally{fs.linkSync=original;fs.rmSync(d,{recursive:true,force:true});}
});
test("archive IDs and item/source locators cannot turn into arbitrary file reads",()=>{
 const d=temp(),a=make();
 try{
  archive.persistArchive(d,a);
  for(const id of ["../source","",a.archive_id.toUpperCase()])assert.throws(()=>archive.loadArchive(d,id),{code:"archive_id"});
  for(const index of [-1,0.1,99,"0"])assert.throws(()=>archive.resolveItem(d,a.archive_id,index),{code:"archive_item"});
  assert.throws(()=>archive.readOriginalRecord(d,a.archive_id,"missing"),{code:"archive_source_id"});
 }finally{fs.rmSync(d,{recursive:true,force:true});}
});
test("archive provenance acceptance does not silently reintroduce the old5000 budget or certify summary semantics",()=>{
 const d=temp(),f=fixture();
 try{
  f.summary.items[0].text+="x".repeat(6000);
  const a=archive.createArchive({...f,summaryMaxChars:20000});assert.ok(a.payload.body.length>5000);
  const accepted=archive.persistArchive(d,a);assert.equal(accepted.status,"TRACEABLE_DERIVED_MEMORY");
  assert.equal(accepted.semantic_correctness,"NOT_CERTIFIED");
  assert.throws(()=>archive.createArchive({...f,summaryMaxChars:5000}),{code:"comparison_summary_budget"});
 }finally{fs.rmSync(d,{recursive:true,force:true});}
});
