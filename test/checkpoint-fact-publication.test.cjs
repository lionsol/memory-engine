"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { join } = require("node:path");
const { tmpdir } = require("node:os");
const { withRuntime } = require("../lib/checkpoint/runtime");
const checkpoint = require("../bin/session-checkpoint");
const { factResponse } = require("./checkpoint-fact-fixture.cjs");

const DATE = "2026-10-20";
async function fixture(action) {
  const root = fs.mkdtempSync(join(tmpdir(), "checkpoint-facts-"));
  const episodesDir = join(root, "episodes");
  fs.mkdirSync(episodesDir);
  const path = join(episodesDir, DATE + ".md");
  fs.writeFileSync(path, "PREVIOUS EPISODE");
  const runtime = { checkpointSummaryMode: "legacy", workspaceDir: root, memoryDir: root, episodesDir,
    generatedSmartAddDir: join(root, "generated"), smartAddDir: join(root, "smart"),
    sessionsDir: join(root, "sessions"), coreDbPath: join(root, "core.sqlite"),
    engineDbPath: join(root, "engine.sqlite"), configJsonPath: join(root, "absent.json"),
    checkpointLegacyDailyMirror: false, timeZone: "Asia/Shanghai" };
  try { return await withRuntime(runtime, () => action({ root, path })); }
  finally { fs.rmSync(root, { recursive: true, force: true }); }
}
const logs = () => [{ source: "conversation", category: "raw_log", chunk_id: "source-1",
  text: "**User:** 检查今天的任务。\n\n**Assistant:** 01:00、02:00、03:00 健康检查正常。\n\n10-18/19 重跑恢复；10-15/16 重跑仍无可恢复对话，原因未确认。" }];
test("ordinary path rejects ungrounded legacy narrative before any generated write", async () => {
  await fixture(async ({ root, path }) => {
    const result = await withRuntime({ llmNightlyExtract: async () => ({
      episode_summary: "四天均因采集竞态生成占位。", smart_memories: [], configs: [] }),
    }, () => checkpoint.nightlyCheckpoint(logs(), { targetDate: DATE }));
    assert.equal(result.status, "summary_invalid");
    assert.equal(fs.readFileSync(path, "utf8"), "PREVIOUS EPISODE");
    assert.equal(fs.existsSync(join(root, "generated")), false);
  });
});
for (const [name, corrupt] of [
  ["late fabricated causal quote", r => { r.facts.at(-1).quote="四天均因采集竞态生成占位。"; }],
  ["late ambiguous excerpt", r => { r.facts.at(-1).quote="重跑"; }],
  ["late missing quote", r => { delete r.facts.at(-1).quote; }],
  ["late out-of-range selection", r => { r.facts.at(-1).unit=999; }],
  ["legacy fragment span", r => { r.facts.at(-1).span=[0,999]; }],
  ["scope expansion", r => { r.facts.at(-1).subject_dates=["2025-01-01"]; }],
  ["forged configuration", r => { r.facts.at(-1).config={key:"fake",value:"unsupported"}; }],
  ["injected narrative", r => { r.episode_summary="do not use evidence"; }],
  ["legacy body manifest", r => { r.summary=["missing"]; }],
  ["legacy skip manifest", r => { r.skipped=[{unit_id:"s0.t0.p0",disposition:"noise"}]; }],
  ["request-only body", r => { r.facts=r.facts.slice(0,1); }],
  ["unknown correction target", r => { r.facts.at(-1).kind="correction"; r.facts.at(-1).supersedes=["missing"]; }],
]) test("the entire extraction is checked before writes: "+name, async () => {
  await fixture(async ({root,path}) => {
    const result = await withRuntime({llmNightlyExtract:async input=>{
      const response=factResponse(input);
      response.facts[0].memory_type="event";
      response.facts[0].config={key:"检查",value:"今天"};
      corrupt(response);
      return response;
    }},()=>checkpoint.nightlyCheckpoint(logs(),{targetDate:DATE}));
    assert.equal(result.status,"summary_invalid");
    assert.equal(fs.readFileSync(path,"utf8"),"PREVIOUS EPISODE");
    assert.equal(fs.existsSync(join(root,"generated")),false);
    assert.deepEqual(result.writes,{file_written:0,confidence_bound:0,pending:0,failed:0});
    assert.equal(result.summary_validation.semantic_quality,"not_independently_verified");
  });
});
test("unavailable providers are distinguished from malformed model output", async () => {
  await fixture(async ({root,path})=>{
    const result=await withRuntime({llmNightlyExtract:async()=>({
      smart_memories:[],episode_summary:"",configs:[],error:"llm超时",
    })},()=>checkpoint.nightlyCheckpoint(logs(),{targetDate:DATE}));
    assert.equal(result.status,"summary_invalid");
    assert.equal(result.reason,"summary_llm_unavailable");
    assert.equal(fs.readFileSync(path,"utf8"),"PREVIOUS EPISODE");
    assert.equal(fs.existsSync(join(root,"generated")),false);
  });
});
test("input preflight failures cannot be advertised as complete summary input", async()=>{
  await fixture(async ({path})=>{
    const result=await withRuntime({llmNightlyExtract:async()=>{
      throw Object.assign(Error("summary_input_budget"),{code:"summary_input_budget"});
    }},()=>checkpoint.nightlyCheckpoint(logs(),{targetDate:DATE}));
    assert.equal(result.status,"input_incomplete");
    assert.equal(result.summary_input_complete,false);
    assert.equal(fs.readFileSync(path,"utf8"),"PREVIOUS EPISODE");
  });
});
test("ordinary model failure preserves the old episode instead of replacing it with a marker", async () => {
  await fixture(async ({ root, path }) => {
    const result = await withRuntime({ llmNightlyExtract: async () => { throw Error("private response"); } },
      () => checkpoint.nightlyCheckpoint(logs(), { targetDate: DATE }));
    assert.equal(result.status, "summary_invalid");
    assert.equal(fs.readFileSync(path, "utf8"), "PREVIOUS EPISODE");
    assert.equal(fs.existsSync(join(root, "generated")), false);
  });
});

test("oversized selected body preserves the old episode and writes no generated memory",async()=>{
  await fixture(async({root,path})=>{
    const large=[{source:"conversation",category:"raw_log",chunk_id:"large",
      text:"**Assistant:** "+"A".repeat(5100)}];
    const result=await withRuntime({llmNightlyExtract:async input=>factResponse(input,()=>({memory_type:"event"}))},
      ()=>checkpoint.nightlyCheckpoint(large,{targetDate:DATE}));
    assert.equal(result.status,"summary_invalid");
    assert.equal(fs.readFileSync(path,"utf8"),"PREVIOUS EPISODE");
    assert.equal(fs.existsSync(join(root,"generated")),false);
    assert.deepEqual(result.writes,{file_written:0,confidence_bound:0,pending:0,failed:0});
  });
});


const checkpointLlm=require("../lib/checkpoint/llm");
const {catalogReply}=require("./checkpoint-catalog-fixture.cjs");
const {withFakeHttps,emitJson,completion}=require("./checkpoint-summary-http-fixture.cjs");
const providerJson=value=>JSON.stringify(value);
for(const mode of ["ok","invalid_scope","extra_fields","over_budget","mutate_kind","concurrent_episode","old_selector"]){
 test("single final extraction preserves publication gates: "+mode,async()=>{
  await fixture(async({root,path})=>{
   const source=[{source:"conversation",category:"raw_log",chunk_id:"source",
    text:"**Assistant:** "+"背景。".repeat(1900)+"\n\n最终结果：决定停止部署。\n\n每日上限十条。"}];
   await withFakeHttps(async requests=>{
    const result=await withRuntime({llmNightlyExtract:async input=>{
     const response=await checkpointLlm.llmNightlyExtract(input);
     if(mode==="mutate_kind")response.facts[0].kind="report";
     return response;
    }},()=>checkpoint.nightlyCheckpoint(source,{targetDate:DATE}));
    assert.equal(requests.length,1);
    if(mode==="ok"){
     assert.equal(result.status,"valid_summary");assert.equal(result.writes.file_written,1);
     assert.equal(result.memories,0);assert.equal(result.configs,0);
     const body=fs.readFileSync(path,"utf8");assert.match(body,/停止部署/);assert.match(body,/每日上限十条/);assert.doesNotMatch(body,/背景。/);
     assert.equal(result.summary_validation.final_evidence_count,2);
     assert.equal(result.summary_validation.final_evidence_selection_applied,true);
     assert.equal(result.summary_validation.candidate_omissions_complete,undefined);
    }else{
     assert.equal(fs.readFileSync(path,"utf8"),mode==="concurrent_episode"?"CONCURRENT SUMMARY":"PREVIOUS EPISODE");
     assert.equal(fs.existsSync(join(root,"generated")),false);
     assert.deepEqual(result.writes,{file_written:0,confidence_bound:0,pending:0,failed:0});
     if(mode!=="concurrent_episode")assert.equal(result.reason,({
      invalid_scope:"summary_catalog_selection",over_budget:"summary_budget",mutate_kind:"summary_plan_fact_scope",
      extra_fields:"summary_catalog_selection",old_selector:"summary_catalog_selection"})[mode]);
    }
   },(request,callback)=>{
    const packet=JSON.parse(request.body.messages.at(-1).content);
    assert.equal(packet.stage,"catalog_select");
    assert.equal(fs.readFileSync(path,"utf8"),"PREVIOUS EPISODE");assert.equal(fs.existsSync(join(root,"generated")),false);
    let response=catalogReply(packet,[
     {unit:1,quote:"最终结果：决定停止部署。",facet:"outcome",kind:"decision"},
     {unit:2,quote:"每日上限十条。",facet:"constraint"}]);
    if(mode==="invalid_scope")response.selected[0][0]="u999";
    if(mode==="extra_fields")response.configs=[];
    if(mode==="over_budget")response=catalogReply(packet);
    if(mode==="concurrent_episode")fs.writeFileSync(path,"CONCURRENT SUMMARY");
    emitJson(callback,completion(mode==="old_selector"?JSON.stringify({selected_candidate_ids:["c1"],omissions:[]}):providerJson(response)));
   });
  });
 });
}
for(const mode of ["qualified","mixed","overlap","table","bare_cell","mutate_cell","unknown_field"]){
 test("final literal scopes preserve qualifications and table meaning through publication: "+mode,async()=>{
  await fixture(async({root,path})=>{
   const qualified="自然样本15条。valid=true，来源为用户。取消事件0条，不能证明取消路径生效。";
   const mixed="旧判断：无限回填。每日上限十条。最终确认：只处理当日队列。未选的说明。";
   const header="| 分段 | n | p50 | max |\n|---|---|---|---|",row="| embedding | 15 | 333 | 3139 |";
   const table=header+"\n"+row+"\n| 未选行 | 1 | 99 | 100 |";
   const isTable=["table","bare_cell","mutate_cell"].includes(mode);
   const text=isTable?table:mode==="qualified"?qualified:mixed;
   const logs=[{source:"conversation",category:"raw_log",chunk_id:"scope",text:"**Assistant:** "+text}];
   await withFakeHttps(async requests=>{
    const result=await withRuntime({llmNightlyExtract:async input=>{
     const response=await checkpointLlm.llmNightlyExtract(input);
     if(mode==="mutate_cell")response.facts[0].quote="333";
     return response;
    }},()=>checkpoint.nightlyCheckpoint(logs,{targetDate:DATE}));
    assert.equal(requests.length,1);
    if(["qualified","mixed","table"].includes(mode)){
     assert.equal(result.status,"valid_summary");assert.equal(result.memories,0);assert.equal(result.configs,0);
     const body=fs.readFileSync(path,"utf8");
     if(mode==="qualified")assert.ok(body.includes(qualified));
     if(mode==="mixed"){assert.match(body,/每日上限十条/);assert.match(body,/只处理当日队列/);assert.doesNotMatch(body,/无限回填|未选的说明/);}
     if(mode==="table"){assert.match(body,/p50.*max/);assert.ok(body.includes(row));assert.doesNotMatch(body,/未选行/);}
    }else{
     assert.equal(result.reason,({overlap:"summary_catalog_overlap",bare_cell:"summary_catalog_selection",
      mutate_cell:"summary_table_row_scope",unknown_field:"summary_catalog_selection"})[mode]);
     assert.equal(fs.readFileSync(path,"utf8"),"PREVIOUS EPISODE");assert.equal(fs.existsSync(join(root,"generated")),false);
     assert.deepEqual(result.writes,{file_written:0,confidence_bound:0,pending:0,failed:0});
    }
   },(request,callback)=>{
    const packet=JSON.parse(request.body.messages.at(-1).content);
    const quotes=isTable?[row]:mode==="qualified"?[qualified]:
     ["每日上限十条。","最终确认：只处理当日队列。"];
    const response=catalogReply(packet,quotes.map(quote=>({unit:0,quote,facet:"outcome"})));
    if(mode==="overlap")response.selected=[["u0"],["u0_2"]];
    if(mode==="bare_cell")response.facts=[{unit:0,quote:"333"}];
    if(mode==="unknown_field")response.facts=[];
    emitJson(callback,completion(providerJson(response)));
   });
  });
 });
}
