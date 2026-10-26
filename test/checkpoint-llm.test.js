import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import https from "node:https";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const checkpointConfig = require("../lib/checkpoint/config.js");
const checkpointLlm = require("../lib/checkpoint/llm.js");

function withPatched(obj, key, value, fn) {
  const prev = obj[key];
  obj[key] = value;
  const finish = () => {
    obj[key] = prev;
  };
  try {
    const result = fn();
    if (result && typeof result.then === "function") {
      return result.finally(finish);
    }
    finish();
    return result;
  } catch (error) {
    finish();
    throw error;
  }
}

function createRequestStub(handler) {
  return (url, options, callback) => {
    const req = new EventEmitter();
    req.write = (chunk) => {
      req.body = String(chunk);
    };
    req.end = () => {
      handler({ url, options, callback, req });
    };
    req.setTimeout = (ms, onTimeout) => {
      req.timeoutMs = ms;
      req.onTimeout = onTimeout;
    };
    req.destroy = () => {
      req.destroyed = true;
    };
    return req;
  };
}

function emitJsonResponse(callback, payload, { statusCode = 200, headers = {} } = {}) {
  const res = new EventEmitter();
  res.headers = headers;
  res.statusCode = statusCode;
  callback(res);
  res.emit("data", JSON.stringify(payload));
  res.emit("end");
}

function createLogger() {
  const entries = [];
  return {
    entries,
    logger: {
      log: (...args) => entries.push({ level: "log", message: args.join(" ") }),
      warn: (...args) => entries.push({ level: "warn", message: args.join(" ") }),
      error: (...args) => entries.push({ level: "error", message: args.join(" ") }),
    },
  };
}

function withPatchedConsole(logger, fn) {
  return withPatched(console, "log", logger.log, () =>
    withPatched(console, "warn", logger.warn, () =>
      withPatched(console, "error", logger.error, fn)));
}

test("llmComplete rejects with provider-specific missing key error", async () => {
  await withPatched(checkpointConfig, "getDSKey", () => "", async () => {
    await assert.rejects(
      checkpointLlm.llmComplete("hi", null, { provider: "deepseek" }),
      /deepseek API key not found/,
    );
  });
});

test("llmComplete chooses Authorization, baseUrl, and default model by provider", async () => {
  await withPatched(checkpointConfig, "getSFKey", () => "sf-key", async () => {
    await withPatched(checkpointConfig, "getSFBaseUrl", () => "https://sf.example/v1", async () => {
      let observed = null;
      await withPatched(https, "request", createRequestStub(({ url, options, callback, req }) => {
        observed = {
          href: String(url),
          auth: options.headers.Authorization,
          body: JSON.parse(req.body),
        };
        emitJsonResponse(callback, { choices: [{ message: { content: "ok" } }] });
      }), async () => {
        const content = await checkpointLlm.llmComplete("hello", null, { provider: "siliconflow" });
        assert.equal(content, "ok");
      });

      assert.equal(observed.href, "https://sf.example/chat/completions");
      assert.equal(observed.auth, "Bearer sf-key");
      assert.equal(observed.body.model, "deepseek-ai/DeepSeek-V3.2");
    });
  });
});

test("llmComplete resolves choices[0].message.content", async () => {
  await withPatched(checkpointConfig, "getDSKey", () => "ds-key", async () => {
    await withPatched(checkpointConfig, "getDSBaseUrl", () => "https://ds.example", async () => {
      await withPatched(https, "request", createRequestStub(({ callback }) => {
        emitJsonResponse(callback, { choices: [{ message: { content: "parsed-content" } }] });
      }), async () => {
        const content = await checkpointLlm.llmComplete("hello", "system", { provider: "deepseek" });
        assert.equal(content, "parsed-content");
      });
    });
  });
});

test("llmComplete preserves non-2xx error-body behavior", async () => {
  await withPatched(checkpointConfig, "getDSKey", () => "ds-key", async () => {
    await withPatched(checkpointConfig, "getDSBaseUrl", () => "https://ds.example", async () => {
      await withPatched(https, "request", createRequestStub(({ callback }) => {
        emitJsonResponse(callback, { error: { message: "server said no" } }, { statusCode: 500 });
      }), async () => {
        await assert.rejects(
          checkpointLlm.llmComplete("hello", null, { provider: "deepseek" }),
          /server said no/,
        );
      });
    });
  });
});


const { factResponse, planResponse, candidateSelectionResponse, providerResponse, textInput } = require("./checkpoint-fact-fixture.cjs");
const { validateAndRenderFacts, EVENT_PLAN, buildFactInput } = require("../lib/checkpoint/ordinary-summary-facts");
async function nightlyFixture(handler,action,overrides={}){
 const config={maxInputChars:45000,maxTokens:4096,timeoutMs:120000,...overrides},calls=[];
 const patches=[
  [checkpointConfig,"resolveCheckpointProviders",()=>({primaryProvider:overrides.primaryProvider||"deepseek",fallbackProvider:overrides.fallbackProvider||"siliconflow",warnings:[]})],
  [checkpointConfig,"resolveCheckpointLlmRequestConfig",()=>config],
  [checkpointConfig,"getDSKey",()=>"ds-key"],[checkpointConfig,"getSFKey",()=>"sf-key"],
  [checkpointConfig,"getDSBaseUrl",()=>"https://ds.example"],[checkpointConfig,"getSFBaseUrl",()=>"https://sf.example/v1"],
  [https,"request",createRequestStub(request=>{
   const body=JSON.parse(request.req.body);calls.push({url:String(request.url),body,timeout:request.req.timeoutMs});
   handler({...request,body,input:JSON.parse(body.messages.at(-1).content)},calls.length);
  })]
 ];
 async function apply(i){if(i===patches.length)return action(calls);const[o,k,v]=patches[i];return withPatched(o,k,v,()=>apply(i+1));}
 return apply(0);
}
function content(callback,value,finish_reason="stop"){emitJsonResponse(callback,{choices:[{message:{content:typeof value==="string"?value:JSON.stringify(value)},finish_reason}]});}
const reply=(callback,input)=>content(callback,providerResponse(input));
test("ordinary flow proposes candidates then selects IDs on the same provider; code preserves all labels and quotes",async()=>{
 const input=textInput("**Assistant:** 最终原因：令牌过期。\n\n归档已完成。");
 await nightlyFixture(({callback,input})=>{
  if(input.stage==="plan"){const p=planResponse(input);p.events[0].evidence[0].kind="correction";p.events[0].evidence[0].facet="cause";return content(callback,p);}
  reply(callback,input);
 },async calls=>{
  const response=await checkpointLlm.llmNightlyExtract(input);
  assert.equal(calls.length,2);assert.deepEqual(calls.map(c=>JSON.parse(c.body.messages[1].content).stage),["plan","select"]);
  assert.deepEqual(calls.map(c=>c.url),["https://ds.example/chat/completions","https://ds.example/chat/completions"]);
  const first=JSON.parse(calls[0].body.messages[1].content),second=JSON.parse(calls[1].body.messages[1].content);
  assert.deepEqual(first.sources.flatMap(s=>s.units.map(u=>u.text)),input.sources.flatMap(s=>s.units.map(u=>u.text)));
  assert.equal(first.fact_contract,undefined);assert.equal(second.event_plan,undefined);
  assert.ok(second.candidates.every(c=>Number.isSafeInteger(c.cost)&&Number.isSafeInteger(c.group_cost)));
  assert.equal(response.facts[0].kind,"correction");assert.equal(response.facts[0].facet,"cause");
  assert.ok(response[EVENT_PLAN]);assert.ok(!JSON.stringify(response).includes("selected_candidate_ids"));
  const result=validateAndRenderFacts(response,input);
  assert.equal(result.validation.selected_candidate_coverage_complete,true);assert.equal(result.validation.model_final_selection_verified,false);
  for(const call of calls){assert.equal(call.body.max_tokens,4096);assert.equal(call.timeout,120000);}
 });
});
test("first transport fallback is followed by ID selection on the successful provider with at most three attempts",async()=>{
 await nightlyFixture(({callback,input},n)=>{if(n===1)return emitJsonResponse(callback,{error:{message:"primary unavailable"}});reply(callback,input);},async calls=>{
  const input=textInput("**Assistant:** 最终完成。"),response=await checkpointLlm.llmNightlyExtract(input);
  assert.equal(validateAndRenderFacts(response,input).validation.selected_candidate_coverage_complete,true);
  assert.deepEqual(calls.map(c=>c.url),["https://ds.example/chat/completions","https://sf.example/chat/completions","https://sf.example/chat/completions"]);
  assert.deepEqual(calls[0].body.messages,calls[1].body.messages);assert.equal(calls[2].body.model,calls[1].body.model);
 });
});
for(const fallbackProvider of ["none","deepseek"])test("first transport has no redundant fallback for "+fallbackProvider,async()=>{
 await nightlyFixture(({callback})=>emitJsonResponse(callback,{error:{message:"failed"}}),async calls=>{
  assert.equal((await checkpointLlm.llmNightlyExtract(textInput("body"))).error,"llm超时");assert.equal(calls.length,1);
 },{fallbackProvider});
});
test("two unavailable candidate transports return unavailable without a selection request",async()=>{
 await nightlyFixture(({callback})=>emitJsonResponse(callback,{error:{message:"failed"}}),async calls=>{
  assert.equal((await checkpointLlm.llmNightlyExtract(textInput("body"))).error,"llm超时");assert.equal(calls.length,2);
 });
});
for(const raw of ["plain private text",'prefix {"events":[]} suffix','{"events":'])test("malformed candidate JSON is refused without retry: "+raw.slice(0,10),async()=>{
 const {entries,logger}=createLogger();
 await withPatchedConsole(logger,()=>nightlyFixture(({callback})=>content(callback,raw),async calls=>{
  await assert.rejects(checkpointLlm.llmNightlyExtract(textInput("private body")),{code:"summary_response_json"});assert.equal(calls.length,1);
 }));
 assert.ok(entries.every(e=>!e.message.includes(raw)&&!e.message.includes("private body")));
});
for(const mode of ["old_facts","missing_event","bad_ref","bad_facet","topic","old_protocol"])test("invalid candidates stop before ID selection: "+mode,async()=>{
 await nightlyFixture(({callback,input})=>{
  if(mode==="old_facts")return content(callback,factResponse(input));
  const p=planResponse(input);
  if(mode==="missing_event")delete p.events;if(mode==="bad_ref")p.events[0].evidence[0].unit=999;
  if(mode==="bad_facet")p.events[0].evidence[0].facet="correction";if(mode==="topic")p.events[0].topic="bad";
  if(mode==="old_protocol")p.protocol="checkpoint-source-facts-v10";content(callback,p);
 },async calls=>{
  const code=["bad_ref","bad_facet"].includes(mode)?"summary_plan_evidence":"summary_plan_structure";
  await assert.rejects(checkpointLlm.llmNightlyExtract(textInput("**Assistant:** 完成。")),{code});assert.equal(calls.length,1);
 });
});
for(const mode of ["transport","json","facts","unknown","duplicate","empty","length","budget"])test("selection failure stops at two requests without repair or retry: "+mode,async()=>{
 const input=textInput("**Assistant:** "+(mode==="budget"?"背景。".repeat(1900):"背景。")+"\n\n最终正常。");
 await nightlyFixture(({callback,input})=>{
  if(input.stage==="plan")return reply(callback,input);
  if(mode==="transport")return emitJsonResponse(callback,{error:{message:"selector unavailable"}});
  if(mode==="json")return content(callback,"invalid JSON");
  let response=candidateSelectionResponse(input);
  if(mode==="facts")response={facts:[]};if(mode==="unknown")response.selected_candidate_ids=["unknown"];
  if(mode==="duplicate")response.selected_candidate_ids.push(response.selected_candidate_ids[0]);
  if(mode==="empty")response.selected_candidate_ids=[];
  content(callback,response,mode==="length"?"length":"stop");
 },async calls=>{
  const code=({transport:"summary_candidate_llm_unavailable",json:"summary_response_json",length:"output_budget",budget:"summary_budget"})[mode]||"summary_candidate_selection";
  await assert.rejects(checkpointLlm.llmNightlyExtract(input),{code});assert.equal(calls.length,2);
 });
});
test("final IDs may remove obsolete candidate events and constraints to meet the actual body budget",async()=>{
 const input=textInput("**Assistant:** "+"过时背景。".repeat(1200)+"\n\n最终结果正常。");
 await nightlyFixture(({callback,input})=>{
  if(input.stage==="plan"){const p=planResponse(input);p.events[0].evidence[0].facet="constraint";return content(callback,p);}
  content(callback,candidateSelectionResponse(input,["c2"]));
 },async calls=>{
  const response=await checkpointLlm.llmNightlyExtract(input),result=validateAndRenderFacts(response,input);
  assert.equal(calls.length,2);assert.match(result.episode_summary,/最终结果正常/);assert.doesNotMatch(result.episode_summary,/过时背景/);
  assert.equal(result.validation.candidate_count,2);assert.equal(result.validation.selected_candidate_count,1);
  assert.equal(result.validation.candidate_pool_coverage_complete,false);
 });
});
test("ID selection must still cover every source",async()=>{
 const input=buildFactInput([{source:"conversation",text:"**Assistant:** 甲完成。"},{source:"conversation",text:"**Assistant:** 乙正常。"}],"2026-10-20");
 await nightlyFixture(({callback,input})=>input.stage==="plan"?reply(callback,input):content(callback,candidateSelectionResponse(input,["c1"])),async calls=>{
  await assert.rejects(checkpointLlm.llmNightlyExtract(input),{code:"summary_source_coverage"});assert.equal(calls.length,2);
 });
});
test("request token/time limits remain per call without a new persistent configuration",async()=>{
 await nightlyFixture(({callback,input})=>reply(callback,input),async calls=>{
  await checkpointLlm.llmNightlyExtract(textInput("body"));
  for(const c of calls){assert.equal(c.body.max_tokens,2048);assert.equal(c.timeout,90000);}
 },{maxTokens:2048,timeoutMs:90000});
});
test("legacy input cannot trigger the first provider request",async()=>{
 await nightlyFixture(()=>assert.fail("must not call"),async calls=>{
  const input=textInput("body");input.protocol="checkpoint-source-facts-v10";
  await assert.rejects(checkpointLlm.llmNightlyExtract(input),{code:"summary_input_protocol"});assert.equal(calls.length,0);
 });
});
test("incomplete input budget stops before the first request",async()=>{
 await nightlyFixture(()=>assert.fail("must not call"),async calls=>{
  await assert.rejects(checkpointLlm.llmNightlyExtract(textInput("x".repeat(50000))),{code:"summary_input_budget"});assert.equal(calls.length,0);
 });
});
test("first response token/envelope limits cannot trigger a retry or selector",async()=>{
 for(const mode of ["length","envelope"])await nightlyFixture(({callback})=>content(callback,mode==="envelope"?"x".repeat(32769):"{}",mode==="length"?"length":"stop"),async calls=>{
  await assert.rejects(checkpointLlm.llmNightlyExtract(textInput("body")),{code:"output_budget"});assert.equal(calls.length,1);
 });
});
test("oversized costed candidate input is rejected locally before request two without slicing",async()=>{
 await nightlyFixture(({callback,input})=>{
  const p=planResponse(input),base=p.events[0];
  p.events=Array.from({length:256},(_,i)=>({...base,id:"e"+i,evidence:[{unit:0,quote:String.fromCharCode(0x4e00+i),facet:"outcome"}]}));content(callback,p);
 },async calls=>{
  const input=textInput("**Assistant:** "+Array.from({length:256},(_,i)=>String.fromCharCode(0x4e00+i)).join(""));
  await assert.rejects(checkpointLlm.llmNightlyExtract(input),{code:"summary_plan_input_budget"});assert.equal(calls.length,1);
 },{maxInputChars:5000,maxTokens:16384});
});
test("diagnostics preserve provider/timing without source text or raw plans",async()=>{
 const {entries,logger}=createLogger();
 await withPatchedConsole(logger,()=>nightlyFixture(({callback,input},n)=>{
  if(n===1)return emitJsonResponse(callback,{error:{message:"ds failed"}});reply(callback,input);
 },()=>checkpointLlm.llmNightlyExtract(textInput("sensitive-looking content"))));
 assert.ok(entries.some(e=>/LLM failed provider=deepseek.*durationMs=/.test(e.message)));
 assert.ok(entries.some(e=>/LLM select provider=siliconflow/.test(e.message)));
 assert.ok(entries.every(e=>!e.message.includes("Bearer ")&&!e.message.includes("sensitive-looking content")));
});
