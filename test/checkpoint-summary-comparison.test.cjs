"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const lab=require("../lib/checkpoint/summary-comparison-lab.cjs"),{buildFactInput}=require("../lib/checkpoint/ordinary-summary-facts");
const cases=require("./fixtures/checkpoint-summary-comparison.json").cases;
const input=()=>buildFactInput(cases[0].logs,"2026-10-20");
function reply(i,items){return {version:lab.VERSION,target_date:i.target_date,binding:lab.buildPrompt(i,"direct").binding,items};}
function summary(i){const us=i.sources.flatMap(s=>s.units);return reply(i,[{topic:"部署时间",text:"已撤回mtime部署推断；实际启用时间需加载日志确认。",evidence:[us[1].id],corrects:[us[0].id]}]);}
function ledger(i){const s=summary(i).items[0];return reply(i,[{id:"e1",scope:"本次部署时间核验",conclusion:s.text,conditions:["mtime不能单独作为部署证据"],unresolved:["实际启用时间"],evidence:s.evidence,corrects:s.corrects}]);}
test("direct and organize see identical complete source and binding",()=>{
 for(const c of cases){const i=buildFactInput(c.logs,"2026-10-20"),a=lab.buildPrompt(i,"direct"),b=lab.buildPrompt(i,"organize");
  assert.equal(a.binding,b.binding);assert.deepEqual(JSON.parse(a.prompt).SOURCE,JSON.parse(b.prompt).SOURCE);
  assert.equal(JSON.parse(a.prompt).SOURCE.sources.flatMap(s=>s.units).length,c.logs.length);
 }
});
test("compose includes full source to verify the untrusted ledger",()=>{
 const i=input(),draft=ledger(i),p=JSON.parse(lab.buildPrompt(i,"compose",{ledger:draft}).prompt);
 assert.deepEqual(p.SOURCE,JSON.parse(lab.buildPrompt(i,"direct").prompt).SOURCE);assert.deepEqual(p.ledger,draft);
 assert.match(lab.buildPrompt(i,"compose",{ledger:draft}).system,/草稿，可能错漏/);
});
test("summary is rewritten; exact original evidence lives outside the body",()=>{
 const i=input(),s=summary(i),result=lab.validateSummary(i,s);
 assert.equal(result.evidence.length,2);assert.equal(result.evidence[0].text,i.sources[1].units[0].text);
 assert.ok(!result.body.includes(i.sources[0].units[0].text));assert.match(result.body,/更正/);
 assert.equal(result.validation.semantic_correctness,"NOT_EVALUATED");assert.equal(result.validation.publishable,false);
});
test("source drift invalidates both summary and ledger",()=>{
 const i=input(),s=summary(i),l=ledger(i);i.sources[0].units[0].text+=" altered";
 assert.throws(()=>lab.validateSummary(i,s),{code:"comparison_binding"});
 assert.throws(()=>lab.buildPrompt(i,"compose",{ledger:l}),{code:"comparison_binding"});
});
test("unknown, repeated, absent and entirely withdrawn support rejected",()=>{
 for(const change of [s=>s.items[0].evidence=["unknown"],s=>s.items[0].evidence.push(s.items[0].evidence[0]),s=>s.items[0].evidence=[],s=>s.items[0].corrects=s.items[0].evidence]){
  const i=input(),s=summary(i);change(s);assert.throws(()=>lab.validateSummary(i,s),{code:"comparison_reference"});
 }
});
test("boundaries reject schema injection and old response protocols",()=>{
 for(const change of [s=>s.facts=[],s=>s.version="checkpoint-source-facts-v15",s=>s.version="checkpoint-summary-comparison-v1",s=>s.items[0].quote="injected"]){
  const i=input(),s=summary(i);change(s);assert.throws(()=>lab.validateSummary(i,s));
 }
});
test("only complete standalone controls excluded and source metadata retained",()=>{
 const i=buildFactInput([{text:"HEARTBEAT_OK",source:"conversation"},{text:"HEARTBEAT_OK is an observed control",source:"conversation",provenance:{kind:"test"}}],"2026-10-20");
 const p=lab.sourcePacket(i);assert.equal(p.sources.length,1);assert.match(p.sources[0].units[0].text,/observed/);
 assert.deepEqual(p.sources[0].provenance,{kind:"test"});
});
test("input and rendered output have distinct hard budgets including citation markers",()=>{
 const i=input(),s=summary(i),r=lab.validateSummary(i,s);
 assert.throws(()=>lab.buildPrompt(i,"direct",{maxInputChars:10}),{code:"comparison_input_budget"});
 assert.equal(lab.validateSummary(i,s,r.bodyChars).bodyChars,r.bodyChars);
 assert.throws(()=>lab.validateSummary(i,s,r.bodyChars-1),{code:"comparison_summary_budget"});
 assert.throws(()=>lab.validateSummary(i,s,NaN),{code:"comparison_input"});
});
test("uncited sources are reported, never treated as complete coverage",()=>{
 const i=input(),s=summary(i);s.items[0].corrects=[];
 const r=lab.validateSummary(i,s);assert.deepEqual(r.uncitedSourceIds,["s0"]);assert.equal(r.validation.coverage,"NOT_EVALUATED");
});
test("valid citations do not certify a false claim: semantic review remains mandatory",()=>{
 const i=input(),s=summary(i);s.items[0].text="部署时间已确认为10:51:54。";
 const r=lab.validateSummary(i,s);assert.equal(r.validation.semantic_correctness,"NOT_EVALUATED");
});
test("comparison runs one direct request and two staged requests without retry",async()=>{
 const i=input(),seen=[];
 const out=await lab.runComparison(i,async p=>{seen.push(p.stage);return JSON.stringify(p.stage==="organize"?ledger(i):summary(i));});
 assert.deepEqual(seen,["direct","organize","compose"]);assert.equal(out.results.direct.status,"READY_FOR_REVIEW");
 assert.equal(out.results.staged.status,"READY_FOR_REVIEW");assert.equal(out.semanticQuality,"NOT_EVALUATED");
});
test("direct failure does not suppress the independent staged arm",async()=>{
 const i=input(),seen=[];
 const out=await lab.runComparison(i,async p=>{seen.push(p.stage);return p.stage==="direct"?"invalid":JSON.stringify(p.stage==="organize"?ledger(i):summary(i));});
 assert.equal(out.results.direct.error,"comparison_response_json");assert.equal(out.results.staged.status,"READY_FOR_REVIEW");
 assert.equal(seen.length,3);
});
test("invalid ledger stops staged arm before compose; no corrective request",async()=>{
 const i=input(),seen=[];
 const out=await lab.runComparison(i,async p=>{seen.push(p.stage);return p.stage==="organize"?"{}":JSON.stringify(summary(i));});
 assert.deepEqual(seen,["direct","organize"]);assert.equal(out.results.staged.status,"REJECTED");
});
test("budget rejection never truncates or requests a replacement",async()=>{
 const i=input(),seen=[];
 const out=await lab.runComparison(i,async p=>{seen.push(p.stage);return JSON.stringify(p.stage==="organize"?ledger(i):summary(i));},{summaryMaxChars:10});
 assert.equal(out.results.direct.error,"comparison_summary_budget");assert.equal(out.results.staged.error,"comparison_summary_budget");assert.equal(seen.length,3);
});
test("historical evidence may be marked corrected when live support is also cited",()=>{
 const i=input(),s=summary(i);s.items[0].evidence.push(s.items[0].corrects[0]);
 const r=lab.validateSummary(i,s);
 assert.equal(r.evidence.length,2);
 assert.deepEqual(r.evidence.find(x=>x.id===s.items[0].corrects[0]).referencedAs,["evidence","corrects"]);
 assert.equal(r.validation.semantic_correctness,"NOT_EVALUATED");
});
test("direct-only executor invokes once with no staged fallback on all failure classes",async()=>{
 const i=input();
 for(const mode of ["success","json","binding","reference","budget","transport"]){
  let calls=0;
  const out=await lab.runDirect(i,async p=>{
   calls++;assert.equal(p.stage,"direct");
   if(mode==="transport")throw Object.assign(new Error("offline"),{code:"offline"});
   if(mode==="json")return "invalid";
   const s=summary(i);
   if(mode==="binding")s.binding="wrong";
   if(mode==="reference")s.items[0].evidence=["unknown"];
   if(mode==="budget")s.items[0].text="x".repeat(5001);
   return JSON.stringify(s);
  });
  assert.equal(calls,1);assert.equal(out.requests.length,1);assert.equal(out.results.staged,undefined);
  assert.equal(out.results.direct.status,mode==="success"?"READY_FOR_REVIEW":"REJECTED");
 }
});
test("direct input-budget failure stops before transport",async()=>{
 let calls=0;const out=await lab.runDirect(input(),async()=>{calls++;return "{}";},{maxInputChars:10});
 assert.equal(calls,0);assert.equal(out.results.direct.error,"comparison_input_budget");
});
test("all fixture source text and metadata survive compact transport exactly",()=>{
 for(const c of cases){
  const i=buildFactInput(c.logs,"2026-10-20"),p=JSON.parse(lab.buildPrompt(i,"direct").prompt);
  assert.equal(p.summary_max_chars,5000);assert.ok(p.summary_target_chars<5000);
  assert.deepEqual(p.SOURCE.sources.flatMap(s=>s.units.map(u=>u[3])),i.sources.flatMap(s=>s.units.map(u=>u.text)));
  for(const s of p.SOURCE.sources)assert.equal(s.source_hash,i.sources.find(x=>x.id===s.id).source_hash);
 }
});
test("ledger supports conditions/unresolved without truncation or mutable validation result",()=>{
 const i=input(),l=ledger(i),copy=lab.validateLedger(i,l);copy.items[0].conditions=[];
 assert.equal(l.items[0].conditions.length,1);l.items[0].unresolved="none";
 assert.throws(()=>lab.validateLedger(i,l),{code:"comparison_schema"});
});
test("experimental instructions preserve the full source, binding and resource budget without changing the default",()=>{
 for(const c of cases){
  const i=buildFactInput(c.logs,"2026-10-20"),before=structuredClone(i);
  const baseline=lab.buildPrompt(i,"direct",{summaryMaxChars:20000});
  const explicit=lab.buildPrompt(i,"direct",{summaryMaxChars:20000,promptVariant:"baseline"});
  const experimental=lab.buildPrompt(i,"direct",{summaryMaxChars:20000,promptVariant:"qualifier_review_v1"});
  assert.deepEqual(baseline,explicit);
  assert.deepEqual(JSON.parse(experimental.prompt),JSON.parse(baseline.prompt));
  assert.equal(experimental.binding,baseline.binding);
  assert.notEqual(experimental.system,baseline.system);
  assert.equal(experimental.inputChars,experimental.system.length+experimental.prompt.length);
  assert.deepEqual(i,before);
 }
});
test("invalid or non-direct experimental variants cannot silently run another prompt",async()=>{
 for(const promptVariant of ["unknown",null,42]){
  let calls=0;
  const result=await lab.runDirect(input(),async()=>{calls++;return "{}";},{promptVariant});
  assert.equal(calls,0);assert.equal(result.results.direct.error,"comparison_input");
 }
 for(const stage of ["organize","compose"])
  assert.throws(()=>lab.buildPrompt(input(),stage,{promptVariant:"qualifier_review_v1"}),{code:"comparison_input"});
});
