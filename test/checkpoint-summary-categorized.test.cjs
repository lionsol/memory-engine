"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const lab=require("../lib/checkpoint/summary-comparison-lab.cjs");
const cat=require("../lib/checkpoint/summary-categorized-lab.cjs");
const {buildFactInput}=require("../lib/checkpoint/ordinary-summary-facts");
const cases=require("./fixtures/checkpoint-summary-comparison.json").cases;
function fixture(){
 const logs=[
  {role:"assistant",source:"conversation",text:"旧判断：目录mtime证明准确部署时刻。"},
  {role:"user",source:"conversation",text:"更正：mtime可能被继承，不能确定部署时刻；每日10条限制仍保留。"},
  {role:"assistant",source:"conversation",text:"已撤回准确部署时刻；实际启用时刻待加载记录确认。"},
  {role:"assistant",source:"conversation",text:"Nightly报告dry-run正常；取消事件0条、缺cancel_stage，只能PENDING。"},
  {role:"assistant",source:"conversation",text:"HEARTBEAT_OK"}
 ];
 const input=buildFactInput(logs,"2026-10-20"),units=lab.sourcePacket(input).sources.flatMap(s=>s.units);
 const binding=cat.buildCategoryPlanPrompt(input).binding;
 const plan={version:cat.VERSION,target_date:input.target_date,binding,categories:[
  {id:"c1",title:"Checkpoint",scope:"部署更正和每日限制",focus_units:[units[0].id]},
  {id:"c2",title:"Nightly与观测",scope:"独立维护和取消证据",focus_units:[units[3].id]}
 ]};
 const response=items=>({version:cat.VERSION,target_date:input.target_date,binding,items});
 const summaries=[
  {category_id:"c1",response:response([{topic:"部署核实",text:"据更正，旧部署时间断言已撤回；实际启用时刻待加载记录确认；每日10条限制保留。",
   evidence:[units[1].id,units[2].id],corrects:[units[0].id]}])},
  {category_id:"c2",response:response([{topic:"维护及取消",text:units[3].text,evidence:[units[3].id],corrects:[]}])}
 ];
 return {input,units,plan,summaries};
}
test("classification and each category receive the same full visible source, including corrections outside focus",()=>{
 for(const c of cases){
  const input=buildFactInput(c.logs,"2026-10-20"),p=cat.buildCategoryPlanPrompt(input);
  const old=lab.buildPrompt(input,"organize"),original=JSON.parse(old.prompt).SOURCE,packet=JSON.parse(p.prompt);
  assert.deepEqual(packet.SOURCE,original);assert.equal(p.binding,old.binding);
  assert.equal(packet.max_categories,4);assert.deepEqual(p.responseFormat,{type:"json_object"});
  const id=original.sources[0].units[0][0];
  const plan={version:cat.VERSION,target_date:input.target_date,binding:p.binding,
   categories:[{id:"one",title:"事项",scope:"完整对话中的事项",focus_units:[id]}]};
  const summary=cat.buildCategorySummaryPrompt(input,plan,"one"),body=JSON.parse(summary.prompt);
  assert.deepEqual(body.SOURCE,original);assert.equal(body.summary_max_chars,20000);
  assert.equal(summary.inputChars,summary.system.length+summary.prompt.length);
 }
 const {input,plan,units}=fixture(),p=JSON.parse(cat.buildCategorySummaryPrompt(input,plan,"c1").prompt);
 assert.deepEqual(p.CATEGORY.focus_units,[units[0].id]);
 assert.ok(p.SOURCE.sources.flatMap(s=>s.units).some(u=>u[0]===units[2].id&&u[3].includes("已撤回")));
});
test("classification is structural guidance, allows shared source anchors, and checks identity and known references",()=>{
 const {input,plan}=fixture();
 const shared=structuredClone(plan);shared.categories[1].focus_units.push(plan.categories[0].focus_units[0]);
 assert.deepEqual(cat.validateCategoryPlan(input,shared),shared);
 for(const change of [
  p=>p.binding="wrong",p=>p.categories=[],p=>p.categories[1].id=p.categories[0].id,
  p=>p.categories[0].focus_units=["missing"],p=>p.categories[0].focus_units=[],
  p=>p.categories[0].title="\ud800",p=>p.categories[0].extra=true,p=>p.stage="categorize"
 ]){
  const bad=structuredClone(plan);change(bad);assert.throws(()=>cat.validateCategoryPlan(input,bad));
 }
 assert.throws(()=>cat.validateCategoryPlan(input,plan,{maxCategories:1}),{code:"category_schema"});
 assert.throws(()=>cat.buildCategorySummaryPrompt(input,plan,"unknown"),{code:"category_unknown"});
});
test("one classify call plus one per category, without a final rewriting request",async()=>{
 const {input,plan,summaries}=fixture(),calls=[];
 const result=await cat.runCategorized(input,async p=>{
  calls.push({stage:p.stage,id:p.categoryId});
  if(p.stage==="categorize")return JSON.stringify(plan);
  return JSON.stringify(summaries.find(s=>s.category_id===p.categoryId).response);
 });
 assert.equal(result.status,"READY_FOR_REVIEW");
 assert.deepEqual(calls,[{stage:"categorize",id:null},{stage:"summarize_category",id:"c1"},{stage:"summarize_category",id:"c2"}]);
 assert.equal(result.publisherCalls,0);assert.equal(result.validation.no_final_rewrite,true);
 assert.equal(result.validation.semantic_correctness,"NOT_EVALUATED");
 assert.equal(result.validation.correction_resolution,"NOT_EVALUATED");assert.equal(result.validation.publishable,false);
 assert.match(result.body,/### Checkpoint/);assert.match(result.body,/### Nightly与观测/);
 for(const s of summaries)for(const row of s.response.items)assert.ok(result.body.includes(row.text));
 assert.deepEqual(result.record.source,input);assert.deepEqual(result.record.plan,plan);
 assert.equal(result.record.categories[0].raw,JSON.stringify(summaries[0].response));
});
test("global citations, correction references and same-titled independent items are retained without merging",()=>{
 const {input,plan,summaries}=fixture();
 summaries[1].response.items.push({...structuredClone(summaries[0].response.items[0]),text:"另一个独立报告，未自动合并。"});
 const projected=cat.projectCategorySummaries(input,plan,summaries.slice().reverse());
 assert.equal(projected.response.items.length,3);
 assert.equal(projected.response.items[0].topic,projected.response.items[2].topic);
 assert.match(projected.body,/\[1,2\]（更正 3）/);
 assert.equal(projected.evidence.length,4);
 assert.ok(projected.unitsWithoutFocus.includes(input.sources[1].units[0].id));
 assert.equal(projected.validation.coverage,"NOT_EVALUATED");
 assert.ok(!projected.body.includes("HEARTBEAT_OK"));
});
test("expanded overall budget accepts bodies over5000; exact UTF16 boundary includes category headings and citations",()=>{
 const {input,plan,summaries}=fixture();
 summaries[0].response.items[0].text+="😀"+"x".repeat(6000);
 const base=cat.projectCategorySummaries(input,plan,summaries);
 assert.ok(base.bodyChars>5000);assert.equal(base.bodyChars,base.body.length);
 const exact=cat.projectCategorySummaries(input,plan,summaries,{summaryMaxChars:base.bodyChars});
 assert.equal(exact.bodyChars,base.bodyChars);
 assert.throws(()=>cat.projectCategorySummaries(input,plan,summaries,{summaryMaxChars:base.bodyChars-1}),
  e=>e.code==="category_summary_budget"&&e.observedChars===base.bodyChars);
 // A per-category target is guidance, not a hard quota: unused room is shared.
 assert.ok(summaries[0].response.items[0].text.length>Math.floor(base.bodyChars/2));
 assert.equal(cat.projectCategorySummaries(input,plan,summaries,{summaryMaxChars:base.bodyChars}).bodyChars,base.bodyChars);
});
test("all source, raw replies and completed categories survive final budget failure, without partial success",async()=>{
 const {input,plan,summaries}=fixture();let calls=0;
 const result=await cat.runCategorized(input,async p=>{
  calls++;return JSON.stringify(p.stage==="categorize"?plan:summaries.find(s=>s.category_id===p.categoryId).response);
 },{summaryMaxChars:20});
 assert.equal(calls,3);assert.equal(result.status,"REJECTED");assert.equal(result.error,"category_summary_budget");
 assert.equal(result.record.categories.length,2);assert.ok(result.record.categories.every(s=>s.raw&&s.response));
 assert.equal(Object.hasOwn(result,"body"),false);assert.equal(result.publishable,false);
 assert.ok(result.record.source.sources.some(s=>s.units.some(u=>u.text==="HEARTBEAT_OK")));
});
test("malformed or failed category stops with prior replies preserved, no retries or skipped-category final body",async()=>{
 for(const mode of ["transport","json","binding","reference","nonstring"]){
  const {input,plan,summaries}=fixture();let calls=0;
  const result=await cat.runCategorized(input,async p=>{
   calls++;
   if(p.stage==="categorize")return JSON.stringify(plan);
   const wire=structuredClone(summaries.find(s=>s.category_id===p.categoryId).response);
   if(p.categoryId==="c2"){
    if(mode==="transport")throw Object.assign(new Error("offline"),{code:"offline"});
    if(mode==="json")return "```json\n"+JSON.stringify(wire)+"\n```";
    if(mode==="nonstring")return {};
    if(mode==="binding")wire.binding="wrong";
    if(mode==="reference")wire.items[0].evidence=["missing"];
   }
   return JSON.stringify(wire);
  });
  assert.equal(calls,3);assert.equal(result.status,"REJECTED");assert.equal(result.categoryId,"c2");
  assert.ok(result.record.categories[0].response);assert.equal(result.record.categories[1].response,null);
  if(["json","binding","reference"].includes(mode))assert.equal(typeof result.record.categories[1].raw,"string");
  assert.equal(result.publisherCalls,0);assert.equal(Object.hasOwn(result,"body"),false);
 }
});
test("invalid classification stops before category calls; request cap and all category input sizes preflight after planning",async()=>{
 for(const mode of ["badplan","requestlimit","longscope"]){
  const {input,plan}=fixture();let calls=0;
  if(mode==="badplan")plan.categories[0].focus_units=["missing"];
  if(mode==="longscope")plan.categories[1].scope="x".repeat(50000);
  const result=await cat.runCategorized(input,async()=>{calls++;return JSON.stringify(plan);},
   mode==="requestlimit"?{maxRequests:2}:undefined);
  assert.equal(calls,1);assert.equal(result.status,"REJECTED");assert.equal(result.record.categories.length,0);
  assert.equal(result.error,{badplan:"category_reference",requestlimit:"category_request_limit",longscope:"category_input_budget"}[mode]);
 }
});
test("preflight rejects impossible configuration/input size without provider calls",async()=>{
 for(const options of [{maxInputChars:1},{summaryMaxChars:0},{maxCategories:9},{maxRequests:10},{maxCategories:0},{summaryMaxChars:NaN}]){
  const {input}=fixture();let calls=0;
  const r=await cat.runCategorized(input,async()=>{calls++;return "";},options);
  assert.equal(calls,0);assert.equal(r.status,"REJECTED");
 }
});
test("input/options snapshots and independent output copies prevent caller mutation during awaits",async()=>{
 const {input,plan,summaries}=fixture(),before=structuredClone(input),opts={summaryMaxChars:20000,maxRequests:3};
 const result=await cat.runCategorized(input,async p=>{
  if(p.stage==="categorize"){
   input.sources[0].units[0].text="外部变更";opts.maxRequests=1;opts.summaryMaxChars=1;
   return JSON.stringify(plan);
  }
  assert.ok(JSON.parse(p.prompt).SOURCE.sources.some(s=>s.units.some(u=>u[3].includes("旧判断"))));
  return JSON.stringify(summaries.find(s=>s.category_id===p.categoryId).response);
 },opts);
 assert.equal(result.status,"READY_FOR_REVIEW");assert.deepEqual(result.record.source,before);
 const oldText=result.response.items[0].text;
 summaries[0].response.items[0].text="被改";plan.categories[0].title="被改";
 assert.equal(result.response.items[0].text,oldText);assert.equal(result.record.plan.categories[0].title,"Checkpoint");
});
test("category completeness is required; semantic contradictions are still explicitly unevaluated",()=>{
 const {input,plan,summaries}=fixture();
 assert.throws(()=>cat.projectCategorySummaries(input,plan,summaries.slice(0,1)),{code:"category_incomplete"});
 assert.throws(()=>cat.projectCategorySummaries(input,plan,[summaries[0],summaries[0]]),{code:"category_incomplete"});
 summaries[0].response.items[0].text="旧部署时间准确无误；但此判断已撤回。";
 const r=cat.projectCategorySummaries(input,plan,summaries);
 assert.equal(r.validation.semantic_correctness,"NOT_EVALUATED");assert.equal(r.validation.correction_resolution,"NOT_EVALUATED");
 assert.equal(r.validation.category_ownership,"NOT_EVALUATED");assert.equal(r.validation.publishable,false);
});
