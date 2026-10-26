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


const { factResponse, planResponse, candidateSelectionResponse, providerResponse, textInput, candidateWire, modelPlanResponse } = require("./checkpoint-fact-fixture.cjs");
const { validateAndRenderFacts, FINAL_EVIDENCE, buildFactInput } = require("../lib/checkpoint/ordinary-summary-facts");
async function nightlyFixture(handler,action,overrides={}){
 const config={maxInputChars:45000,maxTokens:4096,timeoutMs:120000,...overrides},calls=[];
 const patches=[
  [checkpointConfig,"resolveCheckpointProviders",()=>({primaryProvider:overrides.primaryProvider||"deepseek",fallbackProvider:overrides.fallbackProvider||"siliconflow",warnings:[]})],
  [checkpointConfig,"resolveCheckpointLlmRequestConfig",()=>config],
  [checkpointConfig,"getDSKey",()=>"ds-key"],[checkpointConfig,"getSFKey",()=>"sf-key"],
  [checkpointConfig,"getDSBaseUrl",()=>"https://ds.example"],[checkpointConfig,"getSFBaseUrl",()=>"https://sf.example/v1"],
  [https,"request",createRequestStub(request=>{
   const body=JSON.parse(request.req.body);calls.push({url:String(request.url),body,timeout:request.req.timeoutMs});
   handler({...request,body,input:candidateWire(JSON.parse(body.messages.at(-1).content))},calls.length);
  })]
 ];
 async function apply(i){if(i===patches.length)return action(calls);const[o,k,v]=patches[i];return withPatched(o,k,v,()=>apply(i+1));}
 return apply(0);
}
function content(callback,value,finish_reason="stop"){emitJsonResponse(callback,{choices:[{message:{content:typeof value==="string"?value:JSON.stringify(value?.events?modelPlanResponse(value):value)},finish_reason}]});}
const reply=(callback,input)=>content(callback,providerResponse(input));
test("ordinary flow directly extracts final literal evidence in one successful call",async()=>{
 const input=textInput("**Assistant:** 最终原因：令牌过期。\n\n归档已完成。");
 await nightlyFixture(({callback,input})=>{
  assert.equal(input.stage,"final_evidence");
  const p=planResponse(input);p.events[0].evidence[0].kind="correction";p.events[0].evidence[0].facet="cause";content(callback,p);
 },async calls=>{
  const response=await checkpointLlm.llmNightlyExtract(input);
  assert.equal(calls.length,1);
  assert.equal(calls[0].url,"https://ds.example/chat/completions");
  const wire=JSON.parse(calls[0].body.messages[1].content);
  assert.deepEqual(wire.sources.flatMap(s=>s.units.map(u=>u.text)),input.sources.flatMap(s=>s.units.map(u=>u.text)));
  assert.equal(wire.fact_contract,undefined);assert.equal(wire.candidate_rows,undefined);
  assert.equal(response.facts[0].kind,"correction");assert.equal(response.facts[0].facet,"cause");
  assert.ok(response[FINAL_EVIDENCE]);
  const result=validateAndRenderFacts(response,input);
  assert.equal(result.validation.final_evidence_selection_applied,true);
  assert.equal(result.validation.model_final_selection_verified,false);
  assert.equal(calls[0].body.max_tokens,4096);assert.equal(calls[0].timeout,120000);
 });
});
test("transport fallback uses the same complete input and finishes without a selector",async()=>{
 await nightlyFixture(({callback,input},n)=>{if(n===1)return emitJsonResponse(callback,{error:{message:"primary unavailable"}});reply(callback,input);},async calls=>{
  const input=textInput("**Assistant:** 最终完成。"),response=await checkpointLlm.llmNightlyExtract(input);
  assert.equal(validateAndRenderFacts(response,input).validation.final_evidence_selection_applied,true);
  assert.deepEqual(calls.map(c=>c.url),["https://ds.example/chat/completions","https://sf.example/chat/completions"]);
  assert.deepEqual(calls[0].body.messages,calls[1].body.messages);
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
for(const mode of ["old_facts","object_plan","missing_event","bad_ref","bad_facet","topic","old_protocol"])test("invalid candidates stop before ID selection: "+mode,async()=>{
 await nightlyFixture(({callback,input})=>{
  if(mode==="old_facts")return content(callback,factResponse(input));
  if(mode==="object_plan")return content(callback,JSON.stringify(planResponse(input))); // Raw object wire must not be auto-encoded.
  const p=planResponse(input);
  if(mode==="missing_event")delete p.events;if(mode==="bad_ref")p.events[0].evidence[0].unit=999;
  if(mode==="bad_facet")p.events[0].evidence[0].facet="correction";if(mode==="topic")p.events[0].topic="bad";
  if(mode==="old_protocol")p.protocol="checkpoint-source-facts-v10";content(callback,p);
 },async calls=>{
  const code=["bad_ref","bad_facet"].includes(mode)?"summary_plan_evidence":"summary_plan_structure";
  await assert.rejects(checkpointLlm.llmNightlyExtract(textInput("**Assistant:** 完成。")),{code});assert.equal(calls.length,1);
 });
});
for(const mode of ["budget","length","selector"])test("invalid final output has no selector or retry: "+mode,async()=>{
 const input=textInput("**Assistant:** "+(mode==="budget"?"背景。".repeat(1900):"最终正常。"));
 await nightlyFixture(({callback,input})=>{
  content(callback,mode==="selector"?{selected_candidate_ids:["c1"],omissions:[]}:planResponse(input),mode==="length"?"length":"stop");
 },async calls=>{
  await assert.rejects(checkpointLlm.llmNightlyExtract(input),{code:({budget:"summary_budget",length:"output_budget",selector:"summary_plan_structure"})[mode]});
  assert.equal(calls.length,1);
 });
});
test("only final selected excerpts are rendered; omitted long background is never expanded",async()=>{
 const input=textInput("**Assistant:** "+"过时背景。".repeat(1200)+"\n\n最终结果正常。");
 await nightlyFixture(({callback,input})=>content(callback,planResponse(input,[{unit:1,quote:"最终结果正常。"}])),async calls=>{
  const result=validateAndRenderFacts(await checkpointLlm.llmNightlyExtract(input),input);
  assert.equal(calls.length,1);assert.match(result.episode_summary,/最终结果正常/);assert.doesNotMatch(result.episode_summary,/过时背景/);
  assert.equal(result.validation.final_evidence_count,1);
  assert.equal(result.validation.candidate_omissions_complete,undefined);
 });
});
test("final evidence must still cover every source",async()=>{
 const input=buildFactInput([{source:"conversation",text:"**Assistant:** 甲完成。"},{source:"conversation",text:"**Assistant:** 乙正常。"}],"2026-10-20");
 await nightlyFixture(({callback,input})=>content(callback,planResponse(input,[{unit:0,quote:"甲完成。"}])),async calls=>{
  await assert.rejects(checkpointLlm.llmNightlyExtract(input),{code:"summary_plan_source_coverage"});assert.equal(calls.length,1);
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
test("diagnostics preserve provider/timing without source text or raw plans",async()=>{
 const {entries,logger}=createLogger();
 await withPatchedConsole(logger,()=>nightlyFixture(({callback,input},n)=>{
  if(n===1)return emitJsonResponse(callback,{error:{message:"ds failed"}});reply(callback,input);
 },()=>checkpointLlm.llmNightlyExtract(textInput("sensitive-looking content"))));
 assert.ok(entries.some(e=>/LLM failed provider=deepseek.*durationMs=/.test(e.message)));
 assert.ok(entries.some(e=>/LLM fallback succeeded provider=siliconflow/.test(e.message)));
 assert.ok(entries.every(e=>!e.message.includes("Bearer ")&&!e.message.includes("sensitive-looking content")));
});
