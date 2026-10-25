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

const checkpointLlm=require("../lib/checkpoint/llm");
const {withFakeHttps,emitJson,completion}=require("./checkpoint-summary-http-fixture.cjs");
for(const mode of ["ok","retired_derivation","invalid_plan","missing_required","retired","concurrent_episode"]){
  test("plan then quote preserves the whole publication gate: "+mode,async()=>{
    await fixture(async({root,path})=>{
      const large=[{source:"conversation",category:"raw_log",chunk_id:"large",
        text:"**Assistant:** "+"背景。".repeat(1900)+"\n\n最终结果：决定停止部署。\n\n每日上限十条。"}];
      let attempts=0;
      await withFakeHttps(async requests=>{
        const result=await withRuntime({llmNightlyExtract:checkpointLlm.llmNightlyExtract},
          ()=>checkpoint.nightlyCheckpoint(large,{targetDate:DATE}));
        assert.equal(requests.length,mode==="invalid_plan"?1:2);
        if(["ok","retired_derivation"].includes(mode)){
          assert.equal(result.status,"valid_summary");
          assert.equal(result.memories,0);assert.equal(result.configs,0);
          assert.equal(result.writes.file_written,1); // Existing episodic write after both phases pass.
          const body=fs.readFileSync(path,"utf8");
          assert.match(body,/最终结果：决定停止部署/);assert.match(body,/每日上限十条/);
          assert.ok(!body.includes("背景。"));
          assert.equal(result.summary_validation.event_plan_coverage_complete,true);
          assert.equal(result.summary_validation.model_event_plan_verified,false);
          assert.deepEqual(result.summary_validation.plan_retired,[["s0","deploy",0]]);
        }else{
          assert.equal(fs.existsSync(join(root,"generated")),false);
          assert.equal(fs.readFileSync(path,"utf8"),mode==="concurrent_episode"?"CONCURRENT SUMMARY":"PREVIOUS EPISODE");
          if(mode==="invalid_plan")assert.equal(result.reason,"summary_plan_evidence");
          if(mode==="missing_required")assert.equal(result.reason,"summary_plan_fact_coverage");
          if(mode==="retired")assert.equal(result.reason,"summary_plan_retired_fact");
          assert.deepEqual(result.writes,{file_written:0,confidence_bound:0,pending:0,failed:0});
          assert.equal(result.episode,false);
        }
      },(request,callback)=>{
        attempts++;assert.ok(attempts<=2,"a third request is forbidden");
        const packet=JSON.parse(request.body.messages.at(-1).content);
        if(packet.stage==="plan"){
          const plan={protocol:packet.protocol,target_date:packet.target_date,events:[{
            id:"deploy",source_id:"s0",topic:"部署的最终决定与每日限制",retired_units:[0],
            evidence:[{unit:1,facet:"outcome"},{unit:2,facet:"constraint"}]
          }]};
          if(mode==="invalid_plan")plan.events[0].evidence[0].unit=999;
          return emitJson(callback,completion(JSON.stringify(plan)));
        }
        assert.equal(fs.readFileSync(path,"utf8"),"PREVIOUS EPISODE");
        assert.equal(fs.existsSync(join(root,"generated")),false);
        const response=require("./checkpoint-fact-fixture.cjs").plannedFactResponse(packet);
        if(mode==="retired_derivation"){
          response.facts[0].memory_type="preference";
          response.facts[0].config={key:"结果",value:"停止"};
        }
        if(mode==="missing_required")response.facts.pop();
        if(mode==="retired")response.facts.push({unit:0,quote:"背景。".repeat(1900),event_id:"deploy",facet:"outcome"});
        if(mode==="concurrent_episode")fs.writeFileSync(path,"CONCURRENT SUMMARY");
        emitJson(callback,completion(JSON.stringify(response)));
      });
      assert.equal(attempts,mode==="invalid_plan"?1:2);
    });
  });
}
