"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const lab=require("../lib/checkpoint/summary-comparison-lab.cjs"),{buildFactInput}=require("../lib/checkpoint/ordinary-summary-facts");
const cases=require("./fixtures/checkpoint-summary-comparison.json").cases;
// Supplied development rows test presentation, not automatic semantic grouping.
function fixture(){
 const input=buildFactInput([...cases[0].logs,...cases[4].logs,{role:"assistant",source:"conversation",text:"HEARTBEAT_OK"}],"2026-10-20");
 const units=input.sources.flatMap(s=>s.units);
 const ledger={version:lab.VERSION,target_date:input.target_date,binding:lab.buildFinalStatePrompt(input).binding,
  items:[{id:"e1",scope:"本次部署时间核验",conclusion:"报告已撤回旧部署断言。",
   conditions:["mtime不能证明部署时刻"],unresolved:["实际启用时间需加载日志确认"],
   evidence:[units[1].id],corrects:[units[0].id]}]};
 return {input,ledger};
}
test("final-state request carries the same full visible source and existing ledger schema binding",()=>{
 for(const c of cases){
  const input=buildFactInput(c.logs,"2026-10-20"),old=lab.buildPrompt(input,"organize"),p=lab.buildFinalStatePrompt(input);
  const packet=JSON.parse(p.prompt),original=JSON.parse(old.prompt);
  assert.deepEqual(packet.SOURCE,original.SOURCE);assert.equal(p.binding,old.binding);
  assert.equal(packet.version,lab.VERSION);assert.equal(packet.stage,"final_state");
  assert.equal(packet.summary_max_chars,5000);assert.equal(packet.summary_target_chars,3500);
  assert.equal(p.inputChars,p.system.length+p.prompt.length);
  assert.equal(Object.hasOwn(packet,"ledger"),false);assert.equal(Object.hasOwn(packet,"plan"),false);
 }
});
test("projection preserves conclusion, literal qualifiers, unresolved items and correction evidence",()=>{
 const {input,ledger}=fixture(),row=ledger.items[0],result=lab.projectFinalState(input,ledger);
 assert.equal(result.response.items[0].text,row.conclusion+"；条件："+row.conditions[0]+"；未决："+row.unresolved[0]);
 assert.equal(result.response.items[0].topic,row.scope);
 assert.deepEqual(result.response.items[0].evidence,row.evidence);assert.deepEqual(result.response.items[0].corrects,row.corrects);
 assert.match(result.body,/更正/);assert.equal(result.validation.ledger_fields_preserved,true);
 assert.equal(result.validation.semantic_correctness,"NOT_EVALUATED");assert.equal(result.validation.publishable,false);
 const old=input.sources[0].units[0].text;
 assert.ok(!result.body.includes(old));assert.ok(result.evidence.some(x=>x.text===old));
});
test("qualifier values in conclusion also survive: there is no second lossy rewriting step",()=>{
 const {input,ledger}=fixture(),u=input.sources[2].units[0];
 ledger.items=[{id:"natural",scope:"自然样本",conclusion:u.text,conditions:["LIMIT200已满"],unresolved:[],evidence:[u.id],corrects:[]}];
 const result=lab.projectFinalState(input,ledger);
 for(const text of ["before_prompt_build","natural_user_turn","trigger=user","valid=true","started/completed","08:57:33","12:27:18"]){
  assert.ok(result.body.includes(text));
 }
 assert.ok(result.response.items[0].text.startsWith(u.text));
});
test("archive retains all original inputs, even excluded controls and uncited process data",()=>{
 const {input,ledger}=fixture(),result=lab.projectFinalState(input,ledger);
 assert.deepEqual(result.record.source,input);assert.deepEqual(result.record.ledger,ledger);
 assert.ok(result.record.source.sources.some(s=>s.units.some(u=>u.text==="HEARTBEAT_OK")));
 assert.ok(!JSON.parse(lab.buildFinalStatePrompt(input).prompt).SOURCE.sources.some(s=>s.units.some(u=>u[3]==="HEARTBEAT_OK")));
 result.record.source.sources[0].units[0].text="mutated";result.record.ledger.items[0].conditions=[];
 assert.notEqual(input.sources[0].units[0].text,"mutated");assert.equal(ledger.items[0].conditions.length,1);
 const original=result.response.items[0].text;ledger.items[0].conclusion="changed";assert.equal(result.response.items[0].text,original);
});
test("projection does not guess logical keys, merge same titles or delete path-like rows",()=>{
 const {input,ledger}=fixture();ledger.items.push({...structuredClone(ledger.items[0]),id:"e2",conclusion:"另一日期仍待核实。"});
 const pathRow={...structuredClone(ledger.items[0]),id:"e3",scope:"报告路径",conclusion:"报告路径只是未经整理的输入"};
 ledger.items.push(pathRow);
 const result=lab.projectFinalState(input,ledger);
 assert.equal(result.response.items.length,3);assert.equal(result.response.items[0].topic,result.response.items[1].topic);
 assert.ok(result.body.includes(pathRow.conclusion));
 assert.equal(result.validation.coverage,"NOT_EVALUATED");
});
test("body accounting includes all text, separators, citations and UTF-16, with exact 5000 boundary",()=>{
 const {input,ledger}=fixture();ledger.items[0].conditions.push("😀");ledger.items[0].scope+="😀";
 const measured=lab.projectFinalState(input,ledger).bodyChars;
 ledger.items[0].conclusion+="x".repeat(5000-measured);
 assert.equal(lab.projectFinalState(input,ledger).bodyChars,5000);
 ledger.items[0].conclusion+="x";
 assert.throws(()=>lab.projectFinalState(input,ledger),e=>e.code==="comparison_summary_budget"&&e.observedChars===5001);
});
test("existing schema, valid-source binding and reference checks are reused",()=>{
 for(const change of [l=>l.version="checkpoint-summary-comparison-v1",l=>l.items[0].evidence=["missing"],
  l=>l.items[0].conditions=[null],l=>l.items[0].unresolved="none",l=>l.items[0].extra="x",
  l=>l.items[0].evidence=[],l=>l.items[0].conclusion="\ud800"]){
  const {input,ledger}=fixture();change(ledger);assert.throws(()=>lab.projectFinalState(input,ledger));
 }
 const {input,ledger}=fixture();input.sources[1].units[0].text+="changed";
 assert.throws(()=>lab.projectFinalState(input,ledger),{code:"comparison_binding"});
 for(const options of [{summaryMaxChars:5001},{summaryMaxChars:0},{summaryMaxChars:NaN},{maxInputChars:0}]){
  assert.throws(()=>lab.buildFinalStatePrompt(fixture().input,options),{code:"comparison_input"});
 }
});
test("one invocation only on success, malformed output, budget rejection or transport failure",async()=>{
 for(const mode of ["success","json","binding","reference","budget","transport","nonstring"]){
  const {input,ledger}=fixture();let calls=0,raw=null;
  const result=await lab.runFinalState(input,async p=>{
   calls++;assert.equal(p.stage,"final_state");
   if(mode==="transport")throw Object.assign(new Error("offline"),{code:"offline"});
   if(mode==="nonstring")return {};
   if(mode==="binding")ledger.binding="wrong";
   if(mode==="reference")ledger.items[0].evidence=["missing"];
   if(mode==="budget")ledger.items[0].conclusion="x".repeat(6000);
   raw=mode==="json"?"invalid":JSON.stringify(ledger);return raw;
  });
  assert.equal(calls,1);assert.deepEqual(result.requests.map(r=>r.stage),["final_state"]);
  assert.equal(result.status,mode==="success"?"READY_FOR_REVIEW":"REJECTED");
  assert.deepEqual(result.record.source,input);assert.equal(result.record.raw_response,raw);
  assert.equal(result.publisherCalls,0);
  if(mode==="budget"){assert.deepEqual(result.record.ledger,ledger);assert.ok(result.observedChars>5000);}
 }
});
test("soft target is not another hidden hard gate; a 4000-char body remains reviewable",async()=>{
 const {input,ledger}=fixture(),size=lab.projectFinalState(input,ledger).bodyChars;
 ledger.items[0].conclusion+="x".repeat(4000-size);
 const result=await lab.runFinalState(input,async()=>JSON.stringify(ledger));
 assert.equal(result.status,"READY_FOR_REVIEW");assert.equal(result.bodyChars,4000);
 assert.equal(result.validation.publishable,false);
});
test("preflight stops before invoking, and caller mutation cannot alter a running snapshot",async()=>{
 const {input,ledger}=fixture();let calls=0;
 const stopped=await lab.runFinalState(input,async()=>{calls++;},{maxInputChars:1});
 assert.equal(stopped.status,"REJECTED");assert.equal(stopped.error,"comparison_input_budget");
 assert.equal(calls,0);assert.deepEqual(stopped.record.source,input);
 const original=structuredClone(input),raw=JSON.stringify(ledger),options={summaryMaxChars:5000};
 const result=await lab.runFinalState(input,async()=>{
  calls++;input.sources[1].units[0].text="changed";ledger.items[0].conclusion="changed";
  options.summaryMaxChars=1;options.maxInputChars=1;return raw;
 },options);
 assert.equal(calls,1);assert.equal(result.status,"READY_FOR_REVIEW");assert.deepEqual(result.record.source,original);
 assert.equal(result.record.raw_response,raw);assert.match(result.body,/已撤回/);
});
test("no semantic quality claim even when the supplied ledger invents or omits facts",()=>{
 const {input,ledger}=fixture();ledger.items[0].conclusion="部署时刻已确认，所有机制均验证成功。";
 ledger.items[0].conditions=[];ledger.items[0].unresolved=[];
 const r=lab.projectFinalState(input,ledger);
 assert.equal(r.validation.semantic_correctness,"NOT_EVALUATED");assert.equal(r.validation.coverage,"NOT_EVALUATED");
 assert.equal(r.validation.publishable,false);assert.deepEqual(r.record.source,input);
});
