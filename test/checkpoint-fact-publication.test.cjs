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
  const runtime = { workspaceDir: root, memoryDir: root, episodesDir,
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


for(const mode of ["paragraph_ok","paragraph_overlap","paragraph_unaccounted"]){
 test("complete paragraph alternative retains qualifications through the real publisher: "+mode,async()=>{
  await fixture(async({root,path})=>{
   const text="自然样本15条。valid=true，来源为用户。取消事件0条，不能证明取消路径生效。";
   const logs=[{source:"conversation",category:"raw_log",chunk_id:"qualified",text:"**Assistant:** "+text}];
   await withFakeHttps(async requests=>{
    const result=await withRuntime({llmNightlyExtract:checkpointLlm.llmNightlyExtract},()=>checkpoint.nightlyCheckpoint(logs,{targetDate:DATE}));
    assert.equal(requests.length,2);
    if(mode==="paragraph_ok"){
     assert.equal(result.status,"valid_summary");assert.equal(result.memories,0);assert.equal(result.configs,0);
     assert.ok(fs.readFileSync(path,"utf8").includes(text));
     assert.equal(result.summary_validation.model_omission_reasons_verified,false);
    }else{
     assert.equal(result.reason,mode==="paragraph_overlap"?"summary_candidate_overlap":"summary_candidate_omissions");
     assert.equal(fs.readFileSync(path,"utf8"),"PREVIOUS EPISODE");assert.equal(fs.existsSync(join(root,"generated")),false);
     assert.deepEqual(result.writes,{file_written:0,confidence_bound:0,pending:0,failed:0});
    }
   },(request,callback)=>{
    const packet=candidateWire(JSON.parse(request.body.messages.at(-1).content));
    const response=packet.stage==="plan"?{protocol:packet.protocol,target_date:packet.target_date,events:[
     {id:"sample",source_id:"s0",evidence:[{unit:0,quote:"自然样本15条。",facet:"outcome"}]}]}:
     {selected_candidate_ids:mode==="paragraph_overlap"?["c1","p0"]:["p0"],
      omissions:mode==="paragraph_ok"?[{ids:["c1"],reason:"covered",by:["p0"]}]:[]};
    emitJson(callback,completion(providerJson(response)));
   });
  });
 });
}

const checkpointLlm=require("../lib/checkpoint/llm");
const {candidateSelectionResponse,candidateWire,modelPlanResponse}=require("./checkpoint-fact-fixture.cjs");
const providerJson=value=>JSON.stringify(value?.events?modelPlanResponse(value):value);
const {withFakeHttps,emitJson,completion}=require("./checkpoint-summary-http-fixture.cjs");
for(const mode of ["ok","invalid_plan","unknown","duplicate","empty","extra_fields","all_over_budget","mutate_kind","concurrent_episode","transport","missing_omissions","unaccounted","false_budget","invalid_supersession"]){
 test("costed final ID selection preserves publication gates: "+mode,async()=>{
  await fixture(async({root,path})=>{
   const source=[{source:"conversation",category:"raw_log",chunk_id:"source",
    text:"**Assistant:** "+"背景。".repeat(1900)+"\n\n最终结果：决定停止部署。\n\n每日上限十条。"}];
   await withFakeHttps(async requests=>{
    const result=await withRuntime({llmNightlyExtract:async input=>{
     const response=await checkpointLlm.llmNightlyExtract(input);
     if(mode==="mutate_kind")response.facts[0].kind="report";
     return response;
    }},()=>checkpoint.nightlyCheckpoint(source,{targetDate:DATE}));
    assert.equal(requests.length,mode==="invalid_plan"?1:2);
    if(mode==="ok"){
     assert.equal(result.status,"valid_summary");assert.equal(result.writes.file_written,1);
     assert.equal(result.memories,0);assert.equal(result.configs,0);
     const body=fs.readFileSync(path,"utf8");assert.match(body,/停止部署/);assert.match(body,/每日上限十条/);assert.doesNotMatch(body,/背景。/);
     assert.equal(result.summary_validation.candidate_count,3);
     assert.equal(result.summary_validation.selected_candidate_count,2);
     assert.equal(result.summary_validation.candidate_pool_coverage_complete,false);
     assert.equal(result.summary_validation.selected_candidate_coverage_complete,true);
    }else{
     assert.equal(fs.readFileSync(path,"utf8"),mode==="concurrent_episode"?"CONCURRENT SUMMARY":"PREVIOUS EPISODE");
     assert.equal(fs.existsSync(join(root,"generated")),false);
     assert.deepEqual(result.writes,{file_written:0,confidence_bound:0,pending:0,failed:0});
     const reason=({invalid_plan:"summary_plan_evidence",all_over_budget:"summary_budget",mutate_kind:"summary_plan_fact_scope",
      transport:"summary_candidate_llm_unavailable",missing_omissions:"summary_candidate_omissions",unaccounted:"summary_candidate_omissions",
      false_budget:"summary_candidate_budget_reason",invalid_supersession:"summary_candidate_omission_scope"})[mode]||"summary_candidate_selection";
     if(mode!=="concurrent_episode")assert.equal(result.reason,reason);
    }
   },(request,callback)=>{
    const packet=candidateWire(JSON.parse(request.body.messages.at(-1).content));
    if(packet.stage==="plan"){
     const plan={protocol:packet.protocol,target_date:packet.target_date,events:[
      {id:"old",source_id:"s0",evidence:[{unit:0,quote:packet.sources[0].units[0].text,facet:"constraint"}]},
      {id:"final",source_id:"s0",evidence:[{unit:1,quote:packet.sources[0].units[1].text,facet:"outcome",kind:"decision"},
       {unit:2,quote:packet.sources[0].units[2].text,facet:"constraint"}]}]};
     if(mode==="invalid_plan")plan.events[0].evidence[0].unit=999;
     return emitJson(callback,completion(providerJson(plan)));
    }
    assert.equal(packet.stage,"select");assert.ok(packet.candidates.every(c=>Number.isSafeInteger(c.cost)));
    assert.equal(fs.readFileSync(path,"utf8"),"PREVIOUS EPISODE");assert.equal(fs.existsSync(join(root,"generated")),false);
    if(mode==="transport")return emitJson(callback,{error:{message:"offline selector failure"}});
    const response=candidateSelectionResponse(packet,["c2","c3"]);
    if(mode==="unknown")response.selected_candidate_ids=["unknown"];
    if(mode==="duplicate")response.selected_candidate_ids=["c2","c2"];
    if(mode==="empty")response.selected_candidate_ids=[];
    if(mode==="extra_fields"){response.memory_type="event";response.config={key:"结果",value:"停止"};}
    if(mode==="all_over_budget"){response.selected_candidate_ids=packet.candidates.map(c=>c.id);response.omissions=[];}
    if(mode==="missing_omissions")delete response.omissions;
    if(mode==="unaccounted")response.omissions=[];
    if(mode==="false_budget"){response.selected_candidate_ids=["c2"];response.omissions=[{ids:["c1"],reason:"background"},{ids:["c3"],reason:"budget"}];}
    if(mode==="invalid_supersession"){response.selected_candidate_ids=["c1","c2"];response.omissions=[{ids:["c3"],reason:"superseded",by:["c2"]}];}
    if(mode==="concurrent_episode")fs.writeFileSync(path,"CONCURRENT SUMMARY");
    emitJson(callback,completion(providerJson(response)));
   });
  });
 });
}
for(const mode of ["mixed_ok","mixed_extra_quote","mixed_overlap"]){
 test("mixed source paragraphs retain only selected candidate IDs: "+mode,async()=>{
  await fixture(async({root,path})=>{
   const logs=[{source:"conversation",category:"raw_log",chunk_id:"mixed",
    text:"**Assistant:** 旧判断：无限回填。每日上限十条。最终确认：只处理当日队列。未选的说明。"}];
   await withFakeHttps(async requests=>{
    const result=await withRuntime({llmNightlyExtract:checkpointLlm.llmNightlyExtract},()=>checkpoint.nightlyCheckpoint(logs,{targetDate:DATE}));
    assert.equal(requests.length,mode==="mixed_overlap"?1:2);
    if(mode==="mixed_ok"){
     assert.equal(result.status,"valid_summary");assert.equal(result.memories,0);assert.equal(result.configs,0);
     const body=fs.readFileSync(path,"utf8");assert.match(body,/每日上限十条/);assert.match(body,/只处理当日队列/);assert.doesNotMatch(body,/无限回填|未选的说明/);
    }else{
     assert.equal(result.reason,mode==="mixed_overlap"?"summary_plan_evidence_overlap":"summary_candidate_selection");
     assert.deepEqual(result.writes,{file_written:0,confidence_bound:0,pending:0,failed:0});
     assert.equal(fs.readFileSync(path,"utf8"),"PREVIOUS EPISODE");assert.equal(fs.existsSync(join(root,"generated")),false);
    }
   },(request,callback)=>{
    const packet=candidateWire(JSON.parse(request.body.messages.at(-1).content));
    if(packet.stage==="plan")return emitJson(callback,completion(providerJson({protocol:packet.protocol,target_date:packet.target_date,events:[
     {id:"queue",source_id:"s0",evidence:[{unit:0,quote:mode==="mixed_overlap"?"每日上限十条。最终确认：只处理当日队列。":"每日上限十条。",facet:"constraint"},
      {unit:0,quote:"最终确认：只处理当日队列。",facet:"outcome"}]}]})));
    assert.ok(packet.candidates.some(c=>c.origin==="original_paragraph"&&c.quote.includes("无限回填")));
    const response=candidateSelectionResponse(packet);
    if(mode==="mixed_extra_quote")response.facts=[{unit:0,quote:"旧判断：无限回填。"}];
    emitJson(callback,completion(providerJson(response)));
   });
  });
 });
}
for(const mode of ["table_ok","table_plan_cell","table_mutate_cell","table_unknown_header"]){
 test("table meaning is preserved by costed selection before publication: "+mode,async()=>{
  await fixture(async({root,path})=>{
   const header="| 分段 | n | p50 | max |\n|---|---|---|---|",row="| embedding | 15 | 333 | 3139 |";
   const logs=[{source:"conversation",category:"raw_log",chunk_id:"table",
    text:"**Assistant:** "+header+"\n"+row+"\n| 未选行 | 1 | 99 | 100 |"}];
   await withFakeHttps(async requests=>{
    const result=await withRuntime({llmNightlyExtract:async input=>{
     const response=await checkpointLlm.llmNightlyExtract(input);
     if(mode==="table_mutate_cell")response.facts[0].quote="333";
     return response;
    }},()=>checkpoint.nightlyCheckpoint(logs,{targetDate:DATE}));
    assert.equal(requests.length,mode==="table_plan_cell"?1:2);
    if(mode==="table_ok"){
     assert.equal(result.status,"valid_summary");assert.equal(result.memories,0);assert.equal(result.configs,0);
     const body=fs.readFileSync(path,"utf8");assert.match(body,/p50.*max/);assert.ok(body.includes(row));assert.doesNotMatch(body,/未选行/);
    }else{
     assert.equal(result.reason,({table_plan_cell:"summary_plan_table_row_scope",table_mutate_cell:"summary_table_row_scope",
      table_unknown_header:"summary_candidate_selection"})[mode]);
     assert.deepEqual(result.writes,{file_written:0,confidence_bound:0,pending:0,failed:0});
     assert.equal(fs.readFileSync(path,"utf8"),"PREVIOUS EPISODE");assert.equal(fs.existsSync(join(root,"generated")),false);
    }
   },(request,callback)=>{
    const packet=candidateWire(JSON.parse(request.body.messages.at(-1).content));
    if(packet.stage==="plan")return emitJson(callback,completion(providerJson({protocol:packet.protocol,target_date:packet.target_date,events:[
     {id:"latency",source_id:"s0",evidence:[{unit:0,quote:mode==="table_plan_cell"?"333":row,facet:"outcome"}]}]})));
    assert.ok(packet.candidates.find(c=>c.id==="c1").context.some(c=>c.kind==="table_header"&&c.text===header));
    assert.ok(packet.candidates.some(c=>c.origin==="original_paragraph"&&c.quote.includes("未选行")));
    emitJson(callback,completion(providerJson(candidateSelectionResponse(packet,mode==="table_unknown_header"?["header"]:["c1"]))));
   });
  });
 });
}
