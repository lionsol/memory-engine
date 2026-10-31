"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), os = require("node:os");
const { createHash } = require("node:crypto"), { pathToFileURL } = require("node:url");
const archive = require("../lib/checkpoint/summary-memory-archive.cjs");
const projections = require("../lib/checkpoint/episode-projection.cjs");
const locator = require("../lib/checkpoint/derived-summary-locator.cjs");
const lab = require("../lib/checkpoint/summary-comparison-lab.cjs");
const { buildFactInput } = require("../lib/checkpoint/ordinary-summary-facts");
const { renderEpisodeFile } = require("../lib/checkpoint/episode-writer");
const { runCheckpointArchiveMaintenance } = require("../lib/checkpoint/archive-maintenance.cjs");
const DATE = "2026-10-20", EPISODE = "memory/episodes/" + DATE + ".md";
const hash = value => createHash("sha256").update(value).digest("hex");
const coreRoot = process.env.MEMORY_ENGINE_TEST_OPENCLAW_ROOT;
const realCore = { skip: coreRoot ? false : "set MEMORY_ENGINE_TEST_OPENCLAW_ROOT for real provider splitter", timeout: 30000 };
let sdk;
async function loadCore() {
  if (!sdk) sdk = Promise.all([
    import(pathToFileURL(path.join(coreRoot, "dist/plugin-sdk/memory-core-host-engine-storage.js")).href),
    import(pathToFileURL(path.join(coreRoot, "dist/plugin-sdk/memory-core-host-engine-embeddings.js")).href),
  ]).then(([storage, embeddings]) => ({ chunk: storage.chunkMarkdown, split: embeddings.enforceEmbeddingMaxInputTokens }));
  return sdk;
}
function document(stored, prologue = "派生摘要，事实正确性未认证。") {
  return renderEpisodeFile({ episodeDate: DATE, generatedAt: stored.payload.created_at, configs: [],
    episodeText: prologue + "\n\n" + locator.renderDerivedItemLines(stored).join("\n"),
    diagnostics: { derivedSummary: { archive_id: stored.archive_id, previous_archive_id: stored.payload.previous_archive_id } } });
}
function fixture(t, decorate = () => {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "provider-projection-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const rawLogs = [{ source: "conversation", role: "user", text: "参数42；source=before_prompt_build；trigger=user。" },
    { source: "conversation", role: "assistant", text: "助手报告验收通过，没有独立工具返回事件。" }];
  const input = buildFactInput(rawLogs, DATE);
  const summary = { version: lab.VERSION, target_date: DATE, binding: lab.buildPrompt(input, "direct").binding,
    items: [{ topic: "参数", text: Array.from({ length: 52 }, (_, i) => "unique-I0-" + i + "-中文🦊 abcdefghijklmnopqrstuvwxyz.").join(" "),
      evidence: [input.sources[0].units[0].id], corrects: [] },
      { topic: "验收", text: "unique-I1-outcome；验收仅为助手当时转述。", evidence: [input.sources[1].units[0].id], corrects: [] }] };
  const options = { prologue: "HEADER_ONLY_PROOF_20261031" };
  decorate(summary, options);
  const stored = archive.createArchive({ rawLogs, targetDate: DATE, summary,
    generator: { model: "offline-fixture" }, qualityFindings: ["不认证语义或工具实际执行。"] });
  archive.persistArchive(path.join(root, "checkpoint-archives"), stored);
  const text = document(stored, options.prologue), doc = projections.createProjection(stored, text);
  projections.persistProjection(root, doc);
  const verified = projections.verifyProjection(doc, stored);
  return { root, rawLogs, stored, text, doc, ...verified };
}
function candidate(chunk) {
  return { path: EPISODE, text: chunk.text, hash: chunk.hash, start_line: chunk.startLine, end_line: chunk.endLine };
}
function lineSpans(text, itemLines) {
  let cursor = 0;
  const spans = new Map();
  for (const [index, line] of text.split("\n").entries()) {
    spans.set(index + 1, { start: cursor, end: cursor + line.length });
    cursor += line.length + 1;
  }
  return itemLines.map(item => ({ ...item, ...spans.get(item.line) }));
}
function itemsAtSpan(text, spans, start, end) {
  return spans.filter(span => {
    const left = Math.max(start, span.start), right = Math.min(end, span.end);
    return right > left && text.slice(left, right).trim().length > 0;
  }).map(span => span.item_index);
}
function literalScopes(text, spans, fragment) {
  const scopes = new Set();
  for (let index = text.indexOf(fragment); index !== -1; index = text.indexOf(fragment, index + 1)) {
    scopes.add(itemsAtSpan(text, spans, index, index + fragment.length).join(","));
  }
  return scopes;
}
function classify(f, c, expected) {
  try {
    const result = locator.resolveDerivedSnippet(c, { memoryDir: f.root });
    if (result?.metadata.status !== "verified") {
      assert.deepEqual(expected, [], "an item-bearing child must resolve or explicitly reject ambiguity");
      return { status: "outside" };
    }
    assert.ok(expected.length > 0, "parent line bounds cannot turn header text into item evidence");
    assert.deepEqual(result.metadata.item_indexes, expected, "only actual child content may determine item coverage");
    assert.equal(result.metadata.archive_id, f.stored.archive_id);
    return { status: "verified", result };
  } catch (error) {
    if (error.code === "derived_projection_ambiguous") return { status: "ambiguous" };
    throw error;
  }
}
test("line windows locate internal child content, including leading and trailing cut separators", () => {
  const lines = ["first source line", "second source line", "third source line"];
  for (const [text, contentLine] of [["first source line\n",1],["second source line",2],["\nthird source line",3]]) {
    const matches = projections.matchLineWindow(lines, 1, 3, text);
    assert.ok(matches.some(match => match.content_lines.includes(contentLine)));
    assert.ok(matches.every(match => match.content_lines.length === 1));
    assert.equal(projections.matchesRange(lines, 1, 3, text), false);
  }
});
test("real blank lines and spaces cannot be removed or fabricated when matching a child", () => {
  assert.equal(projections.matchLineWindow(["alpha","beta"],1,2,"alpha\n\nbeta").length,0);
  assert.equal(projections.matchLineWindow(["alpha","","beta"],1,3,"alpha\nbeta").length,0);
  assert.equal(projections.matchLineWindow(["alpha","beta"],1,2,"alphabeta").length,0);
  assert.equal(projections.matchLineWindow(["alpha","beta"],1,2,"alpha \nbeta").length,0);
  assert.equal(projections.matchLineWindow(["alpha","","beta"],1,3,"\n\nbeta").length,1);
  assert.equal(projections.matchLineWindow(["alpha","beta"],0,2,"beta").length,0);
});
test("a wide parent line window grants only the child's actual item and source", t => {
  const f = fixture(t), line = f.itemLines[0].line;
  const text = "unique-I0-31-中文🦊 abcdefghijklmnopqrstuvwxyz.";
  const c = { path: EPISODE, text, hash: hash(text), start_line: 1, end_line: f.lines.length };
  const read = locator.resolveDerivedSnippet(c, { memoryDir: f.root, purpose: "exact_parameters", itemIndex: 0 });
  assert.equal(read.metadata.scope, "archived_projection_line_window");
  assert.deepEqual(read.metadata.item_indexes, [0]);
  assert.deepEqual(read.metadata.core_line_window, { start_line: 1, end_line: f.lines.length });
  assert.ok(read.metadata.matched_source_spans.every(span => span.start_line === line && span.end_line === line));
  assert.equal(read.evidence.original_records.length, 1);
  assert.deepEqual(read.evidence.original_records[0].record, f.rawLogs[0]);
  assert.throws(() => locator.resolveDerivedSnippet(c, { memoryDir: f.root, purpose: "acceptance", itemIndex: 1 }),
    { code: "derived_locator_item" });
});
test("header-only provider children gain no source identity from a parent covering summary items", t => {
  const f = fixture(t), text = "HEADER_ONLY_PROOF_20261031";
  const c = { path: EPISODE, text, hash: hash(text), start_line: 1, end_line: f.lines.length };
  assert.equal(locator.resolveDerivedSnippet(c, { memoryDir: f.root }).metadata.status, "locator_unavailable");
  assert.throws(() => locator.resolveDerivedSnippet(c, { memoryDir: f.root, purpose: "execution" }),
    { code: "derived_locator_unavailable" });
});
test("identical child content in multiple items or in a header remains ambiguous even with a requested item index", t => {
  const f = fixture(t, (summary, options) => {
    summary.items[0].text = "SHARED_CHILD_PROOF"; summary.items[1].text = "SHARED_CHILD_PROOF";
    options.prologue = "SHARED_CHILD_PROOF";
  });
  const text = "SHARED_CHILD_PROOF", c = { path: EPISODE, text, hash: hash(text), start_line: 1, end_line: f.lines.length };
  assert.throws(() => locator.resolveDerivedSnippet(c, { memoryDir: f.root, purpose: "execution", itemIndex: 0 }),
    { code: "derived_projection_ambiguous" });
});
test("tampered byte content, outside windows and incorrect hashes remain unusable", t => {
  const f = fixture(t), text = "unique-I0-31-中文🦊 abcdefghijklmnopqrstuvwxyz.";
  const base = { path: EPISODE, text, hash: hash(text), start_line: 1, end_line: f.lines.length };
  for (const c of [{ ...base, text: text + "forged", hash: hash(text + "forged") },
    { ...base, hash: "0".repeat(64) }, { ...base, start_line: 1, end_line: 2 },
    { ...base, end_line: f.lines.length + 1 }]) {
    assert.throws(() => locator.resolveDerivedSnippet(c, { memoryDir: f.root, purpose: "execution" }),
      { code: "derived_locator_unavailable" });
  }
});
test("real SDK provider splitting preserves parent windows and all bytes without calling provider functions", realCore, async t => {
  const f = fixture(t), {chunk,split} = await loadCore();
  const parents = chunk(f.text, {tokens:10000,overlap:0}); assert.equal(parents.length,1);
  const spans = lineSpans(f.text,f.itemLines), totals = { verified:0, ambiguous:0, outside:0, children:0 };
  let providerCalls = 0;
  const noCall = () => { providerCalls++; assert.fail("provider must not be called"); };
  for (const [provider, hardMax] of [[{id:"offline",maxInputTokens:64},undefined],
    [{id:"offline",maxInputTokens:128},undefined],[{id:"offline",maxInputTokens:512},128],
    [{id:"local"},256],[{id:"offline-default"},512]]) {
    provider.embedQuery = noCall; provider.embedBatch = noCall;
    const children = split(provider,parents,hardMax);
    assert.ok(children.length>1);
    assert.equal(children.map(child=>child.text).join(""),parents[0].text);
    let cursor=0;
    for (const child of children) {
      assert.equal(child.startLine,parents[0].startLine); assert.equal(child.endLine,parents[0].endLine);
      assert.ok(child.text.isWellFormed()); assert.equal(child.hash,hash(child.text));
      const expected=itemsAtSpan(f.text,spans,cursor,cursor+child.text.length);
      cursor+=child.text.length;
      if (!child.text.trim()) continue;
      const classified=classify(f,candidate(child),expected);
      totals[classified.status]++; totals.children++;
      if(classified.status==="ambiguous") {
        assert.ok(literalScopes(f.text,spans,child.text).size>1,
          "ambiguity must be independently visible in the original parent text");
      }
    }
  }
  assert.equal(providerCalls,0); assert.ok(totals.verified>0); assert.ok(totals.outside>0);
  t.diagnostic(JSON.stringify({...totals,provider_calls:providerCalls,production_writes:0}));
});
test("real primary Unicode segmentation followed by byte splitting resolves item continuations and boundary newlines", realCore, async t => {
  const f=fixture(t), {chunk,split}=await loadCore(), target=f.itemLines[0].line;
  let checked=0,boundaryNewlines=0,syntheticNewlines=0;
  for(const options of [{tokens:32,overlap:8},{tokens:128,overlap:32},{tokens:400,overlap:80}]) {
    const parents=chunk(f.text,options).filter(parent=>parent.startLine===target&&parent.endLine===target);
    assert.ok(parents.length>0);
    for(const parent of parents) {
      const newline=parent.text.indexOf("\n");
      const prefixBytes=newline>0?Buffer.byteLength(parent.text.slice(0,newline+1),"utf8"):0;
      const caps=new Set([64,...(prefixBytes>4?[prefixBytes-1,prefixBytes]:[])]);
      for(const cap of caps) {
        const children=split({id:"offline",maxInputTokens:cap},[parent]);
        assert.equal(children.map(child=>child.text).join(""),parent.text);
        for(const child of children) {
          if(!child.text.trim())continue;
          const read=locator.resolveDerivedSnippet(candidate(child),{memoryDir:f.root,purpose:"exact_parameters",itemIndex:0});
          assert.deepEqual(read.metadata.item_indexes,[0]);
          assert.deepEqual(read.evidence.original_records[0].record,f.rawLogs[0]);
          if(child.text.startsWith("\n")||child.text.endsWith("\n"))boundaryNewlines++;
          if(child.text.includes("\n"))syntheticNewlines++;
          checked++;
        }
      }
    }
  }
  assert.ok(boundaryNewlines>0); assert.ok(syntheticNewlines>0);
  t.diagnostic(JSON.stringify({children_checked:checked,boundary_newline_children:boundaryNewlines,
    synthetic_newline_children:syntheticNewlines,provider_calls:0,core_database_writes:0}));
});
test("memory_engine_get uses child coverage rather than the inherited parent window for item-scoped reads", async t => {
  const f=fixture(t), {createMemoryEngineGetExecute}=await import("../lib/tools/memory-engine-actions.js");
  const text="unique-I0-31-中文🦊 abcdefghijklmnopqrstuvwxyz.";
  const row={id:"provider-child",path:EPISODE,source:"memory",text,hash:hash(text),start_line:1,
    end_line:f.lines.length,updated_at:1789260000000},seen=[];
  const get=createMemoryEngineGetExecute({get:{memoryDir:f.root,onMemoryEngineGetSuccess:id=>seen.push(id),
    withCoreDb:fn=>fn({prepare:sql=>({all:()=>sql.includes("PRAGMA")?Object.keys(row).map(name=>({name})):[row]})}),
    withEngineDb:fn=>fn({prepare:()=>({all:()=>[]})})}});
  const read=await get("provider-get",{id:row.id,purpose:"acceptance",item_index:0});
  assert.equal(read.found,true,read.reason);assert.deepEqual(read.memory.derived_memory.item_indexes,[0]);
  const denied=await get("provider-wrong-item",{id:row.id,purpose:"acceptance",item_index:1});
  assert.equal(denied.found,false);assert.equal(denied.reason,"derived_locator_item");
  assert.deepEqual(seen,[row.id]);
});
test("captured GPT archive stays traceable after actual provider splitting and backup-only restoration",{
  skip:coreRoot&&process.env.MEMORY_ENGINE_TEST_CHECKPOINT_ARCHIVE?false:"set Core root and captured archive",
  timeout:30000,
},async t=>{
  const source=process.env.MEMORY_ENGINE_TEST_CHECKPOINT_ARCHIVE,bytes=fs.readFileSync(source);
  const stored=JSON.parse(bytes.toString("utf8")),f=fixture(t);
  fs.rmSync(path.join(f.root,projections.ROOT),{recursive:true});
  archive.persistArchive(path.join(f.root,"checkpoint-archives"),stored);
  const text=document(stored),doc=projections.createProjection(stored,text);
  projections.persistProjection(f.root,doc);
  const itemLines=projections.verifyProjection(doc,stored).itemLines,spans=lineSpans(text,itemLines);
  const backupDir=path.join(f.root,"backup");
  runCheckpointArchiveMaintenance({memoryDir:f.root,backupDir});
  fs.rmSync(path.join(f.root,"checkpoint-archives"),{recursive:true});
  fs.rmSync(path.join(f.root,projections.ROOT),{recursive:true});
  const {chunk,split}=await loadCore(),parents=chunk(text,{tokens:10000,overlap:0});
  assert.equal(parents.length,1);assert.equal(parents[0].text,text);
  const children=split({id:"offline",maxInputTokens:128},parents);
  assert.equal(children.map(child=>child.text).join(""),text);
  const totals={verified:0,ambiguous:0,outside:0},seen=new Set(),units=new Set();
  let cursor=0,occurrences=0;
  for(const child of children){
    const expected=itemsAtSpan(text,spans,cursor,cursor+child.text.length);cursor+=child.text.length;
    if(!child.text.trim())continue;
    const c=candidate(child),classified=classify({root:backupDir,stored},c,expected);
    totals[classified.status]++;
    if(classified.status!=="verified")continue;
    for(const index of classified.result.metadata.item_indexes){
      if(seen.has(index))continue;seen.add(index);
      const read=locator.resolveDerivedSnippet(c,{memoryDir:backupDir,purpose:"acceptance",itemIndex:index});
      const item=read.evidence.items[0];occurrences+=item.item.evidence.length+item.item.corrects.length;
      for(const quote of item.sources){
        units.add(quote.locator.unit_id);
        const original=read.evidence.original_records.find(record=>record.source_id===quote.locator.source_id).record;
        assert.equal(original.text.slice(quote.locator.start,quote.locator.end),quote.quote);
      }
    }
  }
  assert.equal(seen.size,stored.payload.summary.items.length);
  assert.deepEqual(fs.readFileSync(source),bytes);
  const sdkFile=path.join(coreRoot,"dist/plugin-sdk/memory-core-host-engine-embeddings.js");
  t.diagnostic(JSON.stringify({...totals,children:children.length,captured_items:seen.size,
    citation_occurrences:occurrences,unique_units:units.size,provider_sdk_sha256:hash(fs.readFileSync(sdkFile)),
    provider_calls:0,model_calls:0,production_writes:0}));
});
