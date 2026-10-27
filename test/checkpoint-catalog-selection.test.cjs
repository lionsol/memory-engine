"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const f=require("../lib/checkpoint/ordinary-summary-facts");
const {textInput}=require("./checkpoint-fact-fixture.cjs");
const reply=(input,selected)=>({protocol:f.PROTOCOL,target_date:input.target_date,selected});
const render=(input,selected)=>f.validateAndRenderFacts(f.completeCatalogSelection(reply(input,selected),input),input);
test("catalog IDs bind exact scopes, preserve nondefault labels and render in source order",()=>{
 const input=textInput("**Assistant:** 旧判断：无限回填。每日上限十条。最终确认：只处理当日队列。");
 const packet=JSON.parse(f.buildCatalogSelectionPrompt(input,45000).prompt);
 assert.equal(packet.stage,"catalog_select");assert.equal(packet.protocol,"checkpoint-source-facts-v15");
 assert.equal(packet.units[0][5].map(p=>p[0]).join(""),input.sources[0].units[0].text);
 const wire=reply(input,[["u0_2","cause","correction"],["u0_1","constraint","decision"]]);
 const response=f.completeCatalogSelection(wire,input),result=f.validateAndRenderFacts(response,input);
 assert.deepEqual(response.facts.map(c=>[c.quote,c.facet,c.kind]),[
  ["每日上限十条。","constraint","decision"],["最终确认：只处理当日队列。","cause","correction"]]);
 assert.deepEqual(result.validation.catalog_selected_ids,["u0_1","u0_2"]);
 assert.equal(result.validation.event_grouping,"source_unit_not_semantic");
 assert.doesNotMatch(result.episode_summary,/无限回填/);
 assert.deepEqual(result.smart_memories,[]);assert.deepEqual(result.configs,[]);
 wire.selected[0][0]="u0";
 assert.doesNotThrow(()=>f.validateAndRenderFacts(response,input));
 assert.throws(()=>{response[f.CATALOG_SELECTION].selected[0][0]="u0";},TypeError);
});
for(const [name,change]of [
 ["unknown",w=>{w.selected=[["u999"]];}],
 ["duplicate",w=>{w.selected=[["u0"],["u0","cause","correction"]];}],
 ["empty",w=>{w.selected=[];}],
 ["too many",w=>{w.selected=Array.from({length:513},()=>["u0"]);}],
 ["quote injection",w=>{w.quote="伪造";}],
 ["fact injection",w=>{w.facts=[];}],
 ["config injection",w=>{w.configs=[];}],
 ["row extra column",w=>{w.selected=[["u0","cause","correction","extra"]];}],
 ["row object",w=>{w.selected=[{id:"u0"}];}],
 ["bare string",w=>{w.selected=["u0"];}],
 ["null facet",w=>{w.selected=[["u0",null,"correction"]];}],
 ["kind in facet",w=>{w.selected=[["u0","correction"]];}],
 ["bad kind",w=>{w.selected=[["u0","cause","constraint"]];}],
 ["old protocol",w=>{w.protocol="checkpoint-source-facts-v14";}],
 ["wrong date",w=>{w.target_date="2026-10-19";}],
 ["preview wire",w=>{delete w.selected;w.selected_ids=["u0"];}],
 ["old literal wire",w=>{delete w.selected;w.events=[["s0",[[0,"完成。"]]]];}],
])test("catalog selection rejects "+name,()=>{
 const input=textInput("**Assistant:** 完成。"),wire=reply(input,[["u0"]]);change(wire);
 assert.throws(()=>f.completeCatalogSelection(wire,input),{code:"summary_catalog_selection"});
});
test("whole and contained fragments cannot be selected together",()=>{
 const input=textInput("**Assistant:** 甲完成。乙受限。");
 assert.throws(()=>render(input,[["u0"],["u0_1"]]),{code:"summary_catalog_overlap"});
});
test("table rows inherit literal columns and trailing pipes without provider copying",()=>{
 const input=textInput("**Assistant:** | 分段 | n | p50 | max |\n|---|---|---|---|\n| embedding | 15 | 333 | 3139 |\n| 其它 | 1 | 9 | 10 |");
 const result=render(input,[["u0_2","uncertainty","observation"]]);
 assert.match(result.episode_summary,/p50.*max/);
 assert.ok(result.episode_summary.includes("| embedding | 15 | 333 | 3139 |"));
 assert.doesNotMatch(result.episode_summary,/其它/);
 assert.throws(()=>render(input,[["u0_1"]]),{code:"summary_catalog_selection"});
});
test("source coverage, user decisions, exact body budget and no secondary selection remain enforced",()=>{
 const input=f.buildFactInput([{text:"**User:** 检查。\n\n**Assistant:** 完成。",source:"conversation"},
 {text:"**Assistant:** 正常。",source:"conversation"}],"2026-10-20");
 assert.throws(()=>render(input,[["u0"],["u2"]]),{code:"summary_plan_source_coverage"});
 assert.doesNotThrow(()=>render(input,[["u0","outcome","decision"],["u2"]]));
 assert.throws(()=>render(input,[["u1"]]),{code:"summary_plan_source_coverage"});
 const long=textInput("**Assistant:** 完成。"+"A".repeat(6000));
 assert.throws(()=>render(long,[["u0"]]),{code:"summary_budget"});
 const response=f.completeCatalogSelection(reply(long,[["u0_0"]]),long);
 assert.throws(()=>f.validateAndRenderFacts(response,long,{selected_fact_ids:["c1"]}),{code:"summary_plan_selection"});
});
test("publication rebinds IDs even if both output facts and final evidence annotation were changed",()=>{
 const input=textInput("**Assistant:** 甲完成。乙受限。");
 const response=f.completeCatalogSelection(reply(input,[["u0_0"]]),input);
 response.facts[0].quote="乙受限。";
 response[f.FINAL_EVIDENCE].events[0].evidence[0].quote="乙受限。";
 assert.throws(()=>f.validateAndRenderFacts(response,input),{code:"summary_plan_fact_scope"});
});
test("catalog cost bounds every supported kind and accounts for source group transitions",()=>{
 const input=textInput("**Assistant:** 甲完成。乙受限。");
 const wire=JSON.parse(f.buildCatalogSelectionPrompt(input,45000).prompt);
 const cost=wire.units[0][5][0][2],group=wire.group_costs["s0/assistant"];
 for(const kind of ["observation","report","decision","hypothesis","correction","request"]){
  const result=render(input,[["u0_0","outcome",kind]]);
  const bound=wire.summary_budget.header_chars+cost+group;
  assert.ok(bound>=result.episode_summary.length);
  assert.ok(bound-result.episode_summary.length<=7);
 }
});
test("same source role returning later is charged again and original IDs are rebound after input changes",()=>{
 const input=textInput("**User:** 决定甲。\n\n**Assistant:** 完成。\n\n**User:** 补充限制。");
 const wire=JSON.parse(f.buildCatalogSelectionPrompt(input,45000).prompt);
 const selected=[["u0","outcome","decision"],["u1"],["u2","constraint"]];
 const result=render(input,selected);
 const upper=wire.summary_budget.header_chars+wire.units.reduce((sum,r)=>sum+r[3]+wire.group_costs[r[1]+"/"+r[2]],0);
 assert.ok(upper>=result.episode_summary.length);
 assert.ok(upper-result.episode_summary.length<=21);
 const original=textInput("**Assistant:** 甲完成。乙受限。");
 const response=f.completeCatalogSelection(reply(original,[["u0_1"]]),original);
 const changed=textInput("**Assistant:** 新增前言。甲完成。乙受限。");
 assert.throws(()=>f.validateAndRenderFacts(response,changed),{code:"summary_plan_fact_scope"});
});
test("input and protocol bounds stop before transport, including an all-control input",()=>{
 const input=textInput("**Assistant:** 完成。"),p=f.buildCatalogSelectionPrompt(input,45000),size=p.system.length+p.prompt.length;
 assert.doesNotThrow(()=>f.buildCatalogSelectionPrompt(input,size));
 assert.throws(()=>f.buildCatalogSelectionPrompt(input,size-1),{code:"summary_catalog_input_budget"});
 assert.throws(()=>f.buildCatalogSelectionPrompt({...input,protocol:"old"},45000),{code:"summary_input_protocol"});
 assert.throws(()=>f.buildCatalogSelectionPrompt(textInput("HEARTBEAT_OK"),45000),{code:"summary_catalog_empty"});
});
