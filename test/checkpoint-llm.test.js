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


const { factResponse, planResponse, plannedFactResponse, providerResponse, textInput } = require("./checkpoint-fact-fixture.cjs");
const { validateAndRenderFacts, EVENT_PLAN } = require("../lib/checkpoint/ordinary-summary-facts");
async function nightlyFixture(handler, action, overrides = {}) {
  const config = { maxInputChars:45000,maxTokens:4096,timeoutMs:120000,...overrides };
  const calls=[];
  const patches=[
    [checkpointConfig,"resolveCheckpointProviders",()=>({primaryProvider:overrides.primaryProvider||"deepseek",
      fallbackProvider:overrides.fallbackProvider||"siliconflow",warnings:[]})],
    [checkpointConfig,"resolveCheckpointLlmRequestConfig",()=>config],
    [checkpointConfig,"getDSKey",()=>"ds-key"],[checkpointConfig,"getSFKey",()=>"sf-key"],
    [checkpointConfig,"getDSBaseUrl",()=>"https://ds.example"],[checkpointConfig,"getSFBaseUrl",()=>"https://sf.example/v1"],
    [https,"request",createRequestStub(request=>{
      const body=JSON.parse(request.req.body);calls.push({url:String(request.url),body,timeout:request.req.timeoutMs});
      handler({...request,body,input:JSON.parse(body.messages.at(-1).content)},calls.length);
    })],
  ];
  async function apply(i){if(i===patches.length)return action(calls);
    const [obj,key,value]=patches[i];return withPatched(obj,key,value,()=>apply(i+1));}
  return apply(0);
}
function content(callback,value,finish_reason="stop"){
  emitJsonResponse(callback,{choices:[{message:{content:typeof value==="string"?value:JSON.stringify(value)},finish_reason}]});
}
function reply(callback,input){content(callback,providerResponse(input));}

test("ordinary flow always plans from complete input then quotes on the same provider, without a third selector",async()=>{
  const input=textInput("**User:** 09:00 需修复\n\n**Assistant:** 10:00 已修复并验证。");
  await nightlyFixture(({callback,input})=>reply(callback,input),async calls=>{
    const result=await checkpointLlm.llmNightlyExtract(input);
    assert.equal(calls.length,2);
    assert.deepEqual(calls.map(c=>JSON.parse(c.body.messages[1].content).stage),["plan","extract"]);
    assert.deepEqual(calls.map(c=>c.url),["https://ds.example/chat/completions","https://ds.example/chat/completions"]);
    assert.ok(result[EVENT_PLAN]);assert.equal(JSON.stringify(result).includes('"events"'),false);
    const rendered=validateAndRenderFacts(result,input);
    assert.match(rendered.episode_summary,/10:00 已修复并验证/);
    assert.equal(rendered.validation.event_plan_coverage_complete,true);
    assert.equal(rendered.validation.model_event_plan_verified,false);
    const first=JSON.parse(calls[0].body.messages[1].content),second=JSON.parse(calls[1].body.messages[1].content);
    assert.deepEqual(first.sources.flatMap(s=>s.units.map(u=>u.text)),input.sources.flatMap(s=>s.units.map(u=>u.text)));
    assert.equal(first.fact_contract,undefined);
    assert.equal(second.fact_contract.enums.kind.includes("correction"),true);
    assert.equal(second.fact_contract.enums.facet.includes("correction"),false);
    assert.match(calls[1].body.messages[0].content,/禁止对不同事项建立关联/);
    for(const call of calls){assert.equal(call.body.max_tokens,4096);assert.equal(call.timeout,120000);}
  });
});
test("fallback is only for the first transport; quotation follows the successful provider with at most three attempts",async()=>{
  await nightlyFixture(({callback,input},n)=>{
    if(n===1)emitJsonResponse(callback,{error:{message:"primary unavailable"}});
    else reply(callback,input);
  },async calls=>{
    const input=textInput("**Assistant:** 最终完成。"),response=await checkpointLlm.llmNightlyExtract(input);
    assert.equal(validateAndRenderFacts(response,input).validation.event_plan_coverage_complete,true);
    assert.deepEqual(calls.map(c=>c.url),["https://ds.example/chat/completions","https://sf.example/chat/completions","https://sf.example/chat/completions"]);
    assert.deepEqual(calls[0].body.messages,calls[1].body.messages);
    assert.equal(calls[2].body.model,calls[1].body.model);
  });
});
for(const fallbackProvider of ["none","deepseek"])test("first-stage transport failure has no extra request for fallback="+fallbackProvider,async()=>{
  await nightlyFixture(({callback})=>emitJsonResponse(callback,{error:{message:"failed"}}),async calls=>{
    const result=await checkpointLlm.llmNightlyExtract(textInput("body"));
    assert.equal(result.error,"llm超时");assert.equal(calls.length,1);
  },{fallbackProvider});
});
test("two failed planning transports return unavailable without a quotation request",async()=>{
  await nightlyFixture(({callback})=>emitJsonResponse(callback,{error:{message:"failed"}}),async calls=>{
    assert.deepEqual(await checkpointLlm.llmNightlyExtract(textInput("body")),{
      smart_memories:[],episode_summary:"",configs:[],error:"llm超时"});
    assert.equal(calls.length,2);
  });
});
for(const raw of ["plain text only sensitive-looking content",'prefix {"events":[]} suffix','{"events":']){
  test("malformed planning JSON is rejected without fallback: "+raw.slice(0,10),async()=>{
    const {entries,logger}=createLogger();
    await withPatchedConsole(logger,()=>nightlyFixture(({callback})=>content(callback,raw),async calls=>{
      await assert.rejects(checkpointLlm.llmNightlyExtract(textInput("private body")),{code:"summary_response_json"});
      assert.equal(calls.length,1);
    }));
    assert.ok(entries.every(e=>!e.message.includes(raw)&&!e.message.includes("private body")));
  });
}
for(const mode of ["old_facts","missing_event","bad_ref","bad_facet","missing_source"]){
  test("invalid planning cannot reach quotation or provider fallback: "+mode,async()=>{
    await nightlyFixture(({callback,input})=>{
      if(mode==="old_facts")return content(callback,factResponse(input));
      const plan=planResponse(input);
      if(mode==="missing_event")delete plan.events;
      if(mode==="bad_ref")plan.events[0].evidence[0].unit=999;
      if(mode==="bad_facet")plan.events[0].evidence[0].facet="correction";
      if(mode==="missing_source")plan.events.pop();
      content(callback,plan);
    },async calls=>{
      const code={old_facts:"summary_plan_structure",missing_event:"summary_plan_structure",
        bad_ref:"summary_plan_evidence",bad_facet:"summary_plan_evidence",missing_source:"summary_plan_structure"}[mode];
      await assert.rejects(checkpointLlm.llmNightlyExtract(textInput("**Assistant:** 已完成。")),{code});
      assert.equal(calls.length,1);
    });
  });
}
for(const mode of ["transport","json","scope","coverage","quote","length","budget"]){
  test("quotation failure stops after two requests with no selector or provider retry: "+mode,async()=>{
    const input=textInput("**Assistant:** "+"背景。".repeat(mode==="budget"?1900:1)+"\n\n最终结果正常。");
    await nightlyFixture(({callback,input})=>{
      if(input.stage==="plan")return reply(callback,input);
      if(mode==="transport")return emitJsonResponse(callback,{error:{message:"quotation unavailable"}});
      if(mode==="json")return content(callback,"bad JSON");
      const response=plannedFactResponse(input);
      if(mode==="scope")response.facts[0].event_id="unknown";
      if(mode==="coverage")response.facts.pop();
      if(mode==="quote")response.facts[0].quote="改写的证据";
      content(callback,response,mode==="length"?"length":"stop");
    },async calls=>{
      const code={transport:"summary_extraction_llm_unavailable",json:"summary_response_json",scope:"summary_plan_fact_scope",
        coverage:"summary_plan_fact_coverage",quote:"summary_quote",length:"output_budget",budget:"summary_budget"}[mode];
      await assert.rejects(checkpointLlm.llmNightlyExtract(input),{code});assert.equal(calls.length,2);
    });
  });
}
test("request limits remain per stage without creating a new persistent configuration surface",async()=>{
  await nightlyFixture(({callback,input})=>reply(callback,input),async calls=>{
    await checkpointLlm.llmNightlyExtract(textInput("body"));
    assert.equal(calls.length,2);
    for(const call of calls){assert.equal(call.body.max_tokens,2048);assert.equal(call.timeout,90000);}
  },{maxTokens:2048,timeoutMs:90000});
});
test("legacy input cannot cause even a first provider request",async()=>{
  await nightlyFixture(()=>assert.fail("must not call"),async calls=>{
    const input=textInput("body");input.protocol="checkpoint-source-facts-v7";
    await assert.rejects(checkpointLlm.llmNightlyExtract(input),{code:"summary_input_protocol"});
    assert.equal(calls.length,0);
  });
});
test("an incomplete input budget stops before the planning request",async()=>{
  await nightlyFixture(()=>assert.fail("must not call"),async calls=>{
    await assert.rejects(checkpointLlm.llmNightlyExtract(textInput("x".repeat(50000))),{code:"summary_input_budget"});
    assert.equal(calls.length,0);
  });
});
test("first-stage token truncation cannot invoke fallback or quotation",async()=>{
  await nightlyFixture(({callback})=>content(callback,"{}", "length"),async calls=>{
    await assert.rejects(checkpointLlm.llmNightlyExtract(textInput("body")),{code:"output_budget"});assert.equal(calls.length,1);
  });
});
test("first-stage response envelope still obeys the existing token-based character bound",async()=>{
  await nightlyFixture(({callback})=>content(callback,"x".repeat(32769)),async calls=>{
    await assert.rejects(checkpointLlm.llmNightlyExtract(textInput("body")),{code:"output_budget"});assert.equal(calls.length,1);
  });
});
test("oversized plan metadata is refused locally before the second request, without slicing",async()=>{
  await nightlyFixture(({callback,input})=>{
    const plan=planResponse(input),base=plan.events[0];
    plan.events=Array.from({length:256},(_,i)=>({...base,id:"e"+i,topic:"topic".repeat(20)}));
    content(callback,plan);
  },async calls=>{
    await assert.rejects(checkpointLlm.llmNightlyExtract(textInput("**Assistant:** 单条结果。")),{code:"summary_plan_input_budget"});
    assert.equal(calls.length,1);
  },{maxInputChars:5000,maxTokens:16384});
});
test("diagnostics preserve provider and timing without source text, raw plans or credentials",async()=>{
  const {entries,logger}=createLogger();
  await withPatchedConsole(logger,()=>nightlyFixture(({callback,input},n)=>{
    if(n===1)emitJsonResponse(callback,{error:{message:"ds failed"}});
    else reply(callback,input);
  },()=>checkpointLlm.llmNightlyExtract(textInput("sensitive-looking content"))));
  assert.ok(entries.some(e=>/LLM failed provider=deepseek.*durationMs=/.test(e.message)));
  assert.ok(entries.some(e=>/LLM extract provider=siliconflow/.test(e.message)));
  assert.ok(entries.every(e=>!e.message.includes("Bearer ")&&!e.message.includes("sensitive-looking content")));
});
