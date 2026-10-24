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
  ["missing late paragraph", r => { r.facts.pop(); }],
  ["scope expansion", r => { r.facts.at(-1).subject_dates=["2025-01-01"]; }],
  ["forged configuration", r => { r.facts.at(-1).config={key:"fake",value:"unsupported"}; }],
  ["injected narrative", r => { r.episode_summary="do not use evidence"; }],
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
