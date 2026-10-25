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


const { factResponse, textInput } = require("./checkpoint-fact-fixture.cjs");
const { validateAndRenderFacts } = require("../lib/checkpoint/ordinary-summary-facts");
async function nightlyFixture(handler, action, overrides = {}) {
  const config = { maxInputChars: 45000, maxTokens: 4096, timeoutMs: 120000, ...overrides };
  const calls = [];
  const patches = [
    [checkpointConfig,"resolveCheckpointProviders",()=>({
      primaryProvider:overrides.primaryProvider || "deepseek",
      fallbackProvider:overrides.fallbackProvider || "siliconflow",warnings:[]})],
    [checkpointConfig,"resolveCheckpointLlmRequestConfig",()=>config],
    [checkpointConfig,"getDSKey",()=>"ds-key"],[checkpointConfig,"getSFKey",()=>"sf-key"],
    [checkpointConfig,"getDSBaseUrl",()=>"https://ds.example"],
    [checkpointConfig,"getSFBaseUrl",()=>"https://sf.example/v1"],
    [https,"request",createRequestStub(request=>{
      const body=JSON.parse(request.req.body);
      calls.push({url:String(request.url),body,timeout:request.req.timeoutMs});
      handler({...request,body,input:JSON.parse(body.messages.at(-1).content)},calls.length);
    })],
  ];
  async function apply(i){if(i===patches.length)return action(calls);
    const [obj,key,value]=patches[i];return withPatched(obj,key,value,()=>apply(i+1));}
  return apply(0);
}
function reply(callback,input,extra={}) {
  emitJsonResponse(callback,{choices:[{message:{content:JSON.stringify(factResponse(input))},
    finish_reason:"stop",...extra}]});
}
test("ordinary request separates instructions/data, retains later corrections and preserves every source", async()=>{
  const input=textInput("**User:** 09:00 需修复\n\n**Assistant:** 10:00 已修复并验证。");
  await nightlyFixture(({callback,input})=>reply(callback,input),async calls=>{
    const result=await checkpointLlm.llmNightlyExtract(input);
    assert.equal(result.protocol,input.protocol);
    assert.match(validateAndRenderFacts(result,input).episode_summary,/10:00 已修复并验证/);
    assert.equal(calls.length,1);const body=calls[0].body;
    assert.equal(body.messages[0].role,"system");
    assert.match(body.messages[0].content,/^EXTRACTION_EXAMPLE: /m);
    assert.ok(!body.messages[1].content.includes("北岬"));
    assert.match(body.messages[0].content,/若保留旧判断，必须同时保留改变其含义的纠正/);
    assert.match(body.messages[0].content,/时间更晚本身不构成纠正证据/);
    assert.match(body.messages[0].content,/禁止对不同事项建立关联/);
    assert.match(body.messages[0].content,/程序保留双方引文，不据此隐藏任何记录/);
    const wire=JSON.parse(body.messages[1].content);
    assert.equal(wire.fact_contract.enums.kind.includes("correction"),true);
    assert.equal(wire.fact_contract.enums.facet.includes("correction"),false);
    assert.deepEqual(wire.fact_contract.required,["unit","quote","event_id","facet"]);
    assert.deepEqual(wire.sources.flatMap(s=>s.units.map(u=>u.text)),
      input.sources.flatMap(s=>s.units.map(u=>u.text)));
    assert.ok(!body.messages[0].content.includes("{chunks_text}"));
    assert.ok(!body.messages[0].content.includes("不超过 300"));
    assert.equal(body.max_tokens,4096);assert.equal(calls[0].timeout,120000);
    assert.equal(body.model,"deepseek-chat");
  });
});
test("ordinary default fallback keeps DeepSeek then SiliconFlow with identical source data",async()=>{
  await nightlyFixture(({callback,input},n)=>{
    if(n===1)emitJsonResponse(callback,{error:{message:"ds failed"}});
    else reply(callback,input);
  },async calls=>{
    const input=textInput("body");
    assert.equal((await checkpointLlm.llmNightlyExtract(input)).protocol,input.protocol);
    assert.deepEqual(calls.map(c=>c.url),["https://ds.example/chat/completions","https://sf.example/chat/completions"]);
    assert.deepEqual(calls[0].body.messages,calls[1].body.messages);
  });
});
for(const fallbackProvider of ["none","deepseek"])test("no extra request for fallback="+fallbackProvider,async()=>{
  await nightlyFixture(({callback})=>emitJsonResponse(callback,{error:{message:"failed"}}),async calls=>{
    const result=await checkpointLlm.llmNightlyExtract(textInput("body"));
    assert.equal(result.error,"llm超时");assert.equal(calls.length,1);
  },{fallbackProvider});
});
test("both transport failures return the existing unavailable payload within two requests",async()=>{
  await nightlyFixture(({callback})=>emitJsonResponse(callback,{error:{message:"failed"}}),async calls=>{
    assert.deepEqual(await checkpointLlm.llmNightlyExtract(textInput("body")),{
      smart_memories:[],episode_summary:"",configs:[],error:"llm超时"});
    assert.equal(calls.length,2);
  });
});
for(const raw of ["plain text only sensitive-looking content",'prefix {"facts":[]} suffix','{"facts":']) {
  test("malformed response is rejected without provider retry: "+raw.slice(0,10),async()=>{
    const {entries,logger}=createLogger();
    await withPatchedConsole(logger,()=>nightlyFixture(({callback})=>{
      emitJsonResponse(callback,{choices:[{message:{content:raw},finish_reason:"stop"}]});
    },async calls=>{
      await assert.rejects(checkpointLlm.llmNightlyExtract(textInput("private body")),{code:"summary_response_json"});
      assert.equal(calls.length,1);
    }));
    assert.ok(entries.every(e=>!e.message.includes(raw)&&!e.message.includes("private body")));
  });
}
test("request budget overrides are preserved without a new configuration surface",async()=>{
  await nightlyFixture(({callback,input})=>reply(callback,input),async calls=>{
    await checkpointLlm.llmNightlyExtract(textInput("body"));
    assert.equal(calls[0].body.max_tokens,2048);assert.equal(calls[0].timeout,90000);
  },{maxInputChars:30000,maxTokens:2048,timeoutMs:90000});
});
test("oversized source or metadata/instructions fail before any request, never substring",async()=>{
  await nightlyFixture(()=>assert.fail("network must not run"),async calls=>{
    await assert.rejects(checkpointLlm.llmNightlyExtract(textInput("x".repeat(50000))),{code:"summary_input_budget"});
    assert.equal(calls.length,0);
  },{maxInputChars:30000});
});
test("provider token truncation is a failure and cannot trigger a quality retry",async()=>{
  await nightlyFixture(({callback,input})=>reply(callback,input,{finish_reason:"length"}),async calls=>{
    await assert.rejects(checkpointLlm.llmNightlyExtract(textInput("body")),{code:"output_budget"});
    assert.equal(calls.length,1);
  });
});
test("ordinary response character envelope is bounded using the existing token limit",async()=>{
  await nightlyFixture(({callback})=>emitJsonResponse(callback,{
    choices:[{message:{content:"x".repeat(32769)},finish_reason:"stop"}]}),async calls=>{
      await assert.rejects(checkpointLlm.llmNightlyExtract(textInput("body")),{code:"output_budget"});
      assert.equal(calls.length,1);
    });
});
test("provider diagnostics retain model/timing without logging source text or credentials",async()=>{
  const {entries,logger}=createLogger();
  await withPatchedConsole(logger,()=>nightlyFixture(({callback,input},n)=>{
    if(n===1)emitJsonResponse(callback,{error:{message:"ds failed"}});
    else reply(callback,input);
  },()=>checkpointLlm.llmNightlyExtract(textInput("sensitive-looking content"))));
  assert.ok(entries.some(e=>/LLM failed provider=deepseek.*durationMs=/.test(e.message)));
  assert.ok(entries.some(e=>/LLM succeeded provider=siliconflow.*durationMs=/.test(e.message)));
  assert.ok(entries.every(e=>!e.message.includes("Bearer ")&&!e.message.includes("sensitive-looking content")));
});

test("oversized valid evidence gets one ID-only selection on the same provider",async()=>{
  const input=textInput("**Assistant:** "+"背景。".repeat(1900)+"\n\n最终结果：决定停止部署。");
  await nightlyFixture(({callback,input},n)=>{
    if(n===1)reply(callback,input);
    else{
      assert.ok(input.candidates.length===2);
      emitJsonResponse(callback,{choices:[{message:{content:'{"selected_fact_ids":["f2"]}'},finish_reason:"stop"}]});
    }
  },async calls=>{
    const response=await checkpointLlm.llmNightlyExtract(input);
    const result=validateAndRenderFacts(response,input);
    assert.equal(calls.length,2);
    assert.deepEqual(calls.map(c=>c.url),["https://ds.example/chat/completions","https://ds.example/chat/completions"]);
    assert.match(result.episode_summary,/最终结果：决定停止部署/);
    assert.ok(!result.episode_summary.includes("背景。"));
    assert.deepEqual(result.validation.summary_fact_ids,["f2"]);
    assert.equal(result.validation.candidate_fact_count,2);
    assert.equal(response.facts.length,2);
  });
});
test("the selector follows the successful fallback provider, with at most three transport attempts",async()=>{
  const input=textInput("**Assistant:** "+"背景。".repeat(1900)+"\n\n最终结果正常。");
  await nightlyFixture(({callback,input},n)=>{
    if(n===1)emitJsonResponse(callback,{error:{message:"primary unavailable"}});
    else if(n===2)reply(callback,input);
    else emitJsonResponse(callback,{choices:[{message:{content:'{"selected_fact_ids":["f2"]}'},finish_reason:"stop"}]});
  },async calls=>{
    const response=await checkpointLlm.llmNightlyExtract(input);
    assert.match(validateAndRenderFacts(response,input).episode_summary,/最终结果正常/);
    assert.deepEqual(calls.map(c=>c.url),["https://ds.example/chat/completions","https://sf.example/chat/completions","https://sf.example/chat/completions"]);
  });
});
for(const mode of ["transport","json","ids","length","budget"]){
  test("selection failure stops without another provider request: "+mode,async()=>{
    const input=textInput("**Assistant:** "+"背景。".repeat(1900)+"\n\n最终结果正常。");
    await nightlyFixture(({callback,input},n)=>{
      if(n===1)return reply(callback,input);
      if(mode==="transport")return emitJsonResponse(callback,{error:{message:"selector unavailable"}});
      const content=mode==="json"?"bad JSON":JSON.stringify({selected_fact_ids:mode==="ids"?["unknown"]:mode==="budget"?["f1","f2"]:["f2"]});
      emitJsonResponse(callback,{choices:[{message:{content},finish_reason:mode==="length"?"length":"stop"}]});
    },async calls=>{
      const code={transport:"summary_selection_llm_unavailable",json:"summary_selection_response_json",
        ids:"summary_selection",length:"output_budget",budget:"summary_budget"}[mode];
      await assert.rejects(checkpointLlm.llmNightlyExtract(input),{code});
      assert.equal(calls.length,2);
    });
  });
}
test("oversized selector input stops before a second request instead of truncating candidates",async()=>{
  const input=textInput("**Assistant:** 单条结果。");
  await nightlyFixture(({callback,input})=>{
    const first=factResponse(input).facts[0];
    emitJsonResponse(callback,{choices:[{message:{content:JSON.stringify({
      protocol:input.protocol,target_date:input.target_date,facts:Array.from({length:256},()=>({...first}))
    })},finish_reason:"stop"}]});
  },async calls=>{
    await assert.rejects(checkpointLlm.llmNightlyExtract(input),{code:"summary_selection_input_budget"});
    assert.equal(calls.length,1);
  },{maxInputChars:5000});
});

test("missing event declarations fail before ID selection without inferring a catalog",async()=>{
  const input=textInput("**Assistant:** "+"背景。".repeat(1900)+"\n\n最终结果正常。");
  await nightlyFixture(({callback,input})=>{
    const response=factResponse(input);
    delete response.facts[0].event_id;
    delete response.facts[0].facet;
    emitJsonResponse(callback,{choices:[{message:{content:JSON.stringify(response)},finish_reason:"stop"}]});
  },async calls=>{
    await assert.rejects(checkpointLlm.llmNightlyExtract(input),{code:"summary_event_structure"});
    assert.equal(calls.length,1);
  });
});
test("invalid quotes fail before any selection request",async()=>{
  const input=textInput("**Assistant:** "+"背景。".repeat(1900)+"\n\n最终结果正常。");
  await nightlyFixture(({callback,input})=>{
    const response=factResponse(input);
    response.facts[0].quote="被改写的背景";
    emitJsonResponse(callback,{choices:[{message:{content:JSON.stringify(response)},finish_reason:"stop"}]});
  },async calls=>{
    await assert.rejects(checkpointLlm.llmNightlyExtract(input),{code:"summary_quote"});
    assert.equal(calls.length,1);
  });
});
