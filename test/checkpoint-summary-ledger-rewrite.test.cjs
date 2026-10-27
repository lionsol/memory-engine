"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {buildFactInput}=require("../lib/checkpoint/ordinary-summary-facts");
const lab=require("../lib/checkpoint/summary-comparison-lab.cjs"),rewrite=require("../lib/checkpoint/summary-budgeted-rewrite.cjs");
const cases=require("./fixtures/checkpoint-summary-comparison.json").cases;
// Hand-organized development ledger. This does not test automatic fact extraction.
function fixture(n=2){
 const input=buildFactInput(Array.from({length:n},(_,i)=>({role:"assistant",source:"conversation",
  text:"事项"+i+"😀：本次只读核验，证据不足；须保留资格条件，启用时间尚未确认。"})),"2026-10-20");
 const units=input.sources.flatMap(s=>s.units);
 const ledger={version:lab.VERSION,target_date:input.target_date,binding:lab.buildPrompt(input,"organize").binding,
  items:units.map((u,i)=>({id:"e"+i,scope:"第"+i+"项本次核验😀",conclusion:("报告称第"+i+"项仍待验证。").repeat(i+2),
   conditions:i===0?["仅本次核验未执行","source=before_prompt_build","原文字符😀不可裁剪"]:[],
   unresolved:i===0?["实际启用时间未确认"]:[],evidence:[u.id],corrects:[]}))};
 return {input,ledger};
}
function naturalFixture(){
 const input=buildFactInput([cases.find(c=>c.id==="natural_sample_eligibility").logs[0],
  {role:"assistant",source:"conversation",text:"agent_id/run_id/session_id齐全，另1条unknown/valid=false已排除；14→15仅初步归因于最新请求完成时点，缺上轮报告及运行时刻，无法确证。"}],"2026-10-20");
 const ledger={version:lab.VERSION,target_date:input.target_date,binding:lab.buildPrompt(input,"organize").binding,
  items:[{id:"natural",scope:"本次自然样本身份核验",conclusion:"报告称窗口去重后有15条合格自然请求。",
   conditions:["UTC2026-10-19 08:57:33至2026-10-20 12:27:18","LIMIT200已满",
    "15/15：traffic_origin=natural_user_turn、valid=true、source=before_prompt_build、trigger=user",
    "身份字段齐全，started/completed齐全","另1条unknown/valid=false已排除"],
   unresolved:["14→15仅初步归因，缺上轮报告/运行时刻，无法确证"],
   evidence:input.sources.flatMap(s=>s.units.map(u=>u.id)),corrects:[]}]};
 return {input,ledger};
}
function wire(plan,texts=plan.items.map(x=>"x".repeat(x.max_text_chars))){
 return {version:rewrite.VERSION,binding:plan.binding,texts};
}
test("short prose cannot erase supplied eligibility values or unresolved limits",()=>{
 const {input,ledger}=naturalFixture(),opts={targetChars:273},plan=rewrite.planLedgerRewrite(input,ledger,opts);
 const result=rewrite.completeLedgerRewrite(input,ledger,wire(plan,["报告称有15条。"]),opts);
 assert.ok(result.bodyChars<=273);
 for(const text of [...ledger.items[0].conditions,...ledger.items[0].unresolved])assert.ok(result.body.includes(text));
 assert.match(result.body,/source=before_prompt_build/);assert.match(result.body,/无法确证/);
 assert.equal(result.validation.ledger_conditions_preserved,true);assert.equal(result.validation.publishable,false);
 assert.equal(result.validation.semantic_correctness,"NOT_EVALUATED");
});
test("actual headings, references, corrections and fixed fields fit exactly at capacity",()=>{
 for(const n of [1,2,17,37]){
  const {input,ledger}=fixture(n);
  if(n>1){ledger.items[1].evidence.push(ledger.items[0].evidence[0]);ledger.items[1].corrects=[ledger.items[0].evidence[0]];}
  const plan=rewrite.planLedgerRewrite(input,ledger),result=rewrite.completeLedgerRewrite(input,ledger,wire(plan));
  assert.equal(result.bodyChars,4500);
  assert.equal(plan.overhead_chars+plan.items.reduce((n,x)=>n+x.max_text_chars,0),4500);
  for(let i=0;i<n;i++){
   assert.equal(result.response.items[i].topic,ledger.items[i].scope);
   assert.deepEqual(result.response.items[i].evidence,ledger.items[i].evidence);
   assert.deepEqual(result.response.items[i].corrects,ledger.items[i].corrects);
   for(const text of [...ledger.items[i].conditions,...ledger.items[i].unresolved])assert.ok(result.response.items[i].text.includes(text));
  }
  if(n>1)assert.match(result.body,/更正/);
 }
});
test("fixed cost includes separators, Unicode and every condition, with no trimming",()=>{
 const {input,ledger}=fixture(1);ledger.items[0].conditions=[" 条件😀 ","条件😀"];ledger.items[0].unresolved=[" 未决😀 "];
 const plan=rewrite.planLedgerRewrite(input,ledger);
 const expected="；条件： 条件😀 ；条件😀；未决： 未决😀 ";
 assert.equal(plan.fixed_qualifier_chars,expected.length);
 const result=rewrite.completeLedgerRewrite(input,ledger,wire(plan,["结论"]));
 assert.equal(result.response.items[0].text,"结论"+expected);
});
test("oversized mandatory fields stop before any invocation, without dropping qualifiers",async()=>{
 const {input,ledger}=fixture(1);
 let calls=0;ledger.items[0].conditions=["必留".repeat(2600)];
 let r=await rewrite.runLedgerRewrite(input,ledger,async()=>{calls++;});
 assert.equal(r.status,"REJECTED");assert.equal(r.error,"rewrite_budget_infeasible");assert.equal(calls,0);
 ledger.items[0].conditions=["短条件"];const p=rewrite.planLedgerRewrite(input,ledger);
 r=await rewrite.runLedgerRewrite(input,ledger,async()=>{calls++;},{targetChars:p.overhead_chars});
 assert.equal(r.error,"rewrite_budget_infeasible");assert.equal(calls,0);
});
test("equal-length changes to fixed qualifiers invalidate a prepared response",()=>{
 const {input,ledger}=fixture(1),plan=rewrite.planLedgerRewrite(input,ledger),w=wire(plan);
 for(const field of ["conditions","unresolved"]){
  const changed=structuredClone(ledger);changed.items[0][field][0]+="X";
  assert.throws(()=>rewrite.completeLedgerRewrite(input,changed,w),{code:"rewrite_binding"});
 }
 const changed=structuredClone(ledger);
 changed.items[0].conditions[0]=changed.items[0].conditions[0].replace("本次","全天");
 assert.throws(()=>rewrite.completeLedgerRewrite(input,changed,w),{code:"rewrite_binding"});
});
test("citations, source binding, ledger schema and original response checks still apply",()=>{
 const {input,ledger}=fixture(1),plan=rewrite.planLedgerRewrite(input,ledger);
 for(const change of [w=>w.conditions=[],w=>w.texts=[],w=>w.texts[0]="",w=>w.texts[0]="\ud800",
  w=>w.texts[0]+="x",w=>w.version="other"]){
  const w=wire(plan);change(w);assert.throws(()=>rewrite.completeLedgerRewrite(input,ledger,w));
 }
 const changed=structuredClone(input);changed.sources[0].units[0].text+="changed";
 assert.throws(()=>rewrite.planLedgerRewrite(changed,ledger),{code:"comparison_binding"});
 const unknown=structuredClone(ledger);unknown.items[0].evidence=["missing"];
 assert.throws(()=>rewrite.planLedgerRewrite(input,unknown),{code:"comparison_reference"});
 const bad=structuredClone(ledger);bad.items[0].conditions=[null];
 assert.throws(()=>rewrite.planLedgerRewrite(input,bad),{code:"comparison_schema"});
});
test("ledger prompt uses all source units and the existing version/binding/texts reply schema",()=>{
 const {input,ledger}=fixture(2),p=rewrite.buildLedgerRewritePrompt(input,ledger),packet=JSON.parse(p.prompt);
 assert.deepEqual(packet.SOURCE.sources.flatMap(s=>s.units.map(u=>u[3])),input.sources.flatMap(s=>s.units.map(u=>u.text)));
 assert.deepEqual(packet.plan.items[0].conditions,ledger.items[0].conditions);
 assert.equal(packet.binding,p.plan.binding);assert.equal(packet.version,rewrite.VERSION);
 assert.equal(packet.stage,"ledger_rewrite");assert.match(p.system,/由程序原样附加/);
 assert.throws(()=>rewrite.buildLedgerRewritePrompt(input,ledger,{maxInputChars:1}),{code:"rewrite_input_budget"});
});
test("ledger writing makes at most one invocation; snapshots survive caller and plan mutation",async()=>{
 for(const mode of ["success","json","over","transport","plan_tamper","caller_mutation"]){
  const {input,ledger}=fixture(1);let calls=0;
  const r=await rewrite.runLedgerRewrite(input,ledger,async p=>{
   calls++;if(mode==="json")return "invalid";
   if(mode==="transport")throw Object.assign(new Error("offline"),{code:"offline"});
   const w=wire(p.plan);
   if(mode==="over")w.texts[0]+="x";
   if(mode==="plan_tamper"){p.plan.items[0].conditions=[];p.plan.items[0].max_text_chars+=10;w.texts[0]+="x";}
   if(mode==="caller_mutation"){ledger.items[0].conditions=[];input.sources[0].units[0].text+="changed";}
   return JSON.stringify(w);
  });
  assert.equal(calls,1);assert.equal(r.requests.length,1);
  assert.equal(r.status,["success","caller_mutation"].includes(mode)?"READY_FOR_REVIEW":"REJECTED");
  if(mode==="caller_mutation")assert.match(r.body,/source=before_prompt_build/);
 }
});
test("a qualifier left only in conclusion is still losable: ledger extraction must be reviewed",()=>{
 const {input,ledger}=naturalFixture();
 ledger.items[0].conclusion+="source=before_prompt_build。";
 ledger.items[0].conditions=ledger.items[0].conditions.filter(x=>!x.includes("source="));
 const plan=rewrite.planLedgerRewrite(input,ledger),r=rewrite.completeLedgerRewrite(input,ledger,wire(plan,["报告称有15条。"]));
 assert.ok(!r.body.includes("source=before_prompt_build"));
 assert.equal(r.validation.ledger_conditions_preserved,true);
 assert.equal(r.validation.semantic_correctness,"NOT_EVALUATED");assert.equal(r.validation.publishable,false);
});
test("literal preservation certifies neither ledger extraction nor rewritten semantic correctness",()=>{
 const {input,ledger}=fixture(1);ledger.items[0].conditions.push("编造的条件也不会被结构检查识别");
 const plan=rewrite.planLedgerRewrite(input,ledger);
 const r=rewrite.completeLedgerRewrite(input,ledger,wire(plan,["全部验证成功，启用时间已确认。"]));
 assert.equal(r.validation.semantic_correctness,"NOT_EVALUATED");assert.equal(r.validation.coverage,"NOT_EVALUATED");
 assert.equal(r.validation.publishable,false);assert.match(r.body,/编造的条件/);assert.match(r.body,/启用时间未确认/);
});
