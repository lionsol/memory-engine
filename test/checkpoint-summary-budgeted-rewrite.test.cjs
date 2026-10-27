"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {buildFactInput}=require("../lib/checkpoint/ordinary-summary-facts");
const lab=require("../lib/checkpoint/summary-comparison-lab.cjs"),rewrite=require("../lib/checkpoint/summary-budgeted-rewrite.cjs");
function fixture(n=3){
 const input=buildFactInput(Array.from({length:n},(_,i)=>({text:"事项"+i+"当前证据不足；需保留适用阶段和资格条件。",role:"assistant",source:"conversation"})),"2026-10-20");
 const units=input.sources.flatMap(s=>s.units),draft={version:lab.VERSION,target_date:input.target_date,binding:lab.buildPrompt(input,"direct").binding,
  items:units.map((u,i)=>({topic:"事项"+i+"😀",text:("第"+i+"项仍需验证，").repeat(i+10),evidence:[u.id],corrects:[]}))};
 return {input,draft};
}
function atCapacity(plan){return {version:rewrite.VERSION,binding:plan.binding,texts:plan.items.map(r=>"x".repeat(r.max_text_chars))};}
test("all item capacities plus real heading/citation layout fit exactly, including astral Unicode",()=>{
 for(const n of [1,2,17,37]){
  const {input,draft}=fixture(n),plan=rewrite.planRewrite(input,draft),wire=atCapacity(plan);
  const result=rewrite.completeRewrite(input,draft,wire);
  assert.equal(result.bodyChars,4500);assert.equal(result.response.items.length,n);
  assert.ok(result.bodyChars<=5000);assert.equal(result.validation.semantic_correctness,"NOT_EVALUATED");
  for(let i=0;i<n;i++){assert.equal(result.response.items[i].topic,draft.items[i].topic);assert.deepEqual(result.response.items[i].evidence,draft.items[i].evidence);}
 }
});
test("one item exceeding its own budget is refused even when global output would fit",()=>{
 const {input,draft}=fixture(),plan=rewrite.planRewrite(input,draft),wire=atCapacity(plan);
 wire.texts[0]+="x";wire.texts[1]="x";
 assert.throws(()=>rewrite.completeRewrite(input,draft,wire),{code:"rewrite_item_budget"});
});
test("topic and correction marker overhead cannot be hidden by short text",()=>{
 const {input,draft}=fixture(2);draft.items[1].evidence.push(draft.items[0].evidence[0]);draft.items[1].corrects=[draft.items[0].evidence[0]];
 const p=rewrite.planRewrite(input,draft);
 assert.throws(()=>rewrite.planRewrite(input,draft,{targetChars:p.overhead_chars,maxChars:5000}),{code:"rewrite_budget_infeasible"});
 const result=rewrite.completeRewrite(input,draft,atCapacity(p));assert.match(result.body,/更正/);
 assert.deepEqual(result.response.items[1].corrects,draft.items[1].corrects);
});
test("unknown citations, source drift and invalid original annotations remain rejected",()=>{
 const {input,draft}=fixture();draft.items[0].evidence=["unknown"];
 assert.throws(()=>rewrite.planRewrite(input,draft),{code:"comparison_reference"});
});
test("response binding includes draft content, source and allocated budget",()=>{
 const {input,draft}=fixture(),plan=rewrite.planRewrite(input,draft),wire=atCapacity(plan);
 const changed=structuredClone(draft);changed.items[0].text+=" changed";
 assert.throws(()=>rewrite.completeRewrite(input,changed,wire),{code:"rewrite_binding"});
 assert.throws(()=>rewrite.completeRewrite(input,draft,wire,{targetChars:4400}),{code:"rewrite_binding"});
 const source=structuredClone(input);source.sources[0].units[0].text+=" changed";
 assert.throws(()=>rewrite.completeRewrite(source,draft,wire),{code:"comparison_binding"});
});
test("writer cannot alter references or add/remove sections through output fields",()=>{
 const {input,draft}=fixture(),plan=rewrite.planRewrite(input,draft);
 for(const change of [w=>w.evidence=[],w=>w.texts.pop(),w=>w.texts.push("extra"),w=>w.texts=[],w=>w.texts[0]="",w=>w.texts[0]="\ud800"]){
  const wire=atCapacity(plan);change(wire);assert.throws(()=>rewrite.completeRewrite(input,draft,wire));
 }
});
test("settings never raise the 5000-char body limit or silently shrink an impossible layout",()=>{
 const {input,draft}=fixture();
 for(const opts of [{targetChars:6000,maxChars:6000},{targetChars:5001},{targetChars:NaN},{maxInputChars:0}]){
  assert.throws(()=>rewrite.planRewrite(input,draft,opts),{code:"rewrite_settings"});
 }
 assert.throws(()=>rewrite.buildRewritePrompt(input,draft,{maxInputChars:1}),{code:"rewrite_input_budget"});
});
test("writer sees unchanged full source rather than only the model draft",()=>{
 const {input,draft}=fixture(),p=JSON.parse(rewrite.buildRewritePrompt(input,draft).prompt);
 assert.deepEqual(p.SOURCE.sources.flatMap(s=>s.units.map(u=>u[3])),input.sources.flatMap(s=>s.units.map(u=>u.text)));
 assert.deepEqual(p.plan.items.map(r=>r.evidence),draft.items.map(r=>r.evidence));
});
test("single writing attempt: failure does not trigger another provider call",async()=>{
 const {input,draft}=fixture();
 for(const mode of ["success","json","count","over","transport","plan_tamper"]){
  let calls=0;
  const result=await rewrite.runRewrite(input,draft,async p=>{
   calls++;if(mode==="transport")throw Object.assign(new Error("offline"),{code:"offline"});
   if(mode==="json")return "not json";
   const wire=atCapacity(p.plan);
   if(mode==="count")wire.texts.pop();
   if(mode==="over")wire.texts[0]+="x";
   if(mode==="plan_tamper"){p.plan.items[0].max_text_chars+=100;wire.texts[0]+="x";}
   return JSON.stringify(wire);
  });
  assert.equal(calls,1);assert.equal(result.requests.length,1);
  assert.equal(result.status,mode==="success"?"READY_FOR_REVIEW":"REJECTED");
 }
 let calls=0;const stopped=await rewrite.runRewrite(input,draft,async()=>{calls++;},{maxInputChars:1});
 assert.equal(calls,0);assert.equal(stopped.status,"REJECTED");
});
test("short contradictory prose can pass length checks: semantics are deliberately not certified",()=>{
 const {input,draft}=fixture(1),plan=rewrite.planRewrite(input,draft);
 const result=rewrite.completeRewrite(input,draft,{version:rewrite.VERSION,binding:plan.binding,texts:["已全部验证成功。"]});
 assert.equal(result.validation.semantic_correctness,"NOT_EVALUATED");assert.equal(result.validation.publishable,false);
});
