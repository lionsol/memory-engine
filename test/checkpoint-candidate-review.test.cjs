"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {buildFactInput,buildCandidateSelectionPrompt,completeCandidateSelection,validateAndRenderFacts,EVENT_PLAN}=require("../lib/checkpoint/ordinary-summary-facts");
const {textInput,planResponse,candidateWire}=require("./checkpoint-fact-fixture.cjs");
function paragraph(){
 const input=textInput("**Assistant:** 窗口内自然请求15条。valid=true，来源为用户。取消事件0条，不能证明路径被触发。\n\n另一个未进入规划的事项。");
 const plan=planResponse(input,[{unit:0,quote:"窗口内自然请求15条。",event_id:"sample",facet:"outcome"}]);
 return {input,plan,wire:candidateWire(JSON.parse(buildCandidateSelectionPrompt(plan,input,45000).prompt))};
}
const result=(plan,input,selection)=>validateAndRenderFacts(completeCandidateSelection(plan,selection,input),input);
test("complete original paragraph is an explicit costed alternative with its omitted qualifications",()=>{
 const {input,plan,wire}=paragraph(),p=wire.candidates.find(c=>c.id==="p0");
 assert.equal(p.origin,"original_paragraph");assert.equal(p.quote,input.sources[0].units[0].text);
 assert.equal(p.kind,"report");assert.equal(p.event_id,"paragraph_0");
 assert.ok(!wire.candidates.some(c=>c.unit===1)); // No recovery of a wholly absent paragraph.
 const reply={selected_candidate_ids:["p0"],omissions:[{ids:["c1"],reason:"covered",by:["p0"]}]};
 const response=completeCandidateSelection(plan,reply,input),rendered=validateAndRenderFacts(response,input);
 assert.match(rendered.episode_summary,/valid=true/);assert.match(rendered.episode_summary,/不能证明路径被触发/);
 assert.deepEqual(rendered.validation.paragraph_candidate_ids,["p0"]);
 assert.equal(rendered.validation.candidate_omissions_complete,true);
 assert.equal(rendered.validation.model_omission_reasons_verified,false);
 assert.deepEqual(rendered.smart_memories,[]);assert.deepEqual(rendered.configs,[]);
 reply.omissions[0].ids.push("forged");
 assert.doesNotThrow(()=>validateAndRenderFacts(response,input)); // Annotation was copied, not aliased.
 response.facts[0].quote="窗口内自然请求15条。";
 assert.throws(()=>validateAndRenderFacts(response,input),{code:"summary_plan_fact_scope"});
});
test("selecting a full paragraph and its overlapping narrow quote is rejected",()=>{
 const {input,plan}=paragraph();
 assert.throws(()=>result(plan,input,{selected_candidate_ids:["c1","p0"],omissions:[]}),{code:"summary_candidate_overlap"});
});
for(const [name,reply,code]of [
 ["missing ledger",{selected_candidate_ids:["c1"]},"summary_candidate_omissions"],
 ["unaccounted alternative",{selected_candidate_ids:["c1"],omissions:[]},"summary_candidate_omissions"],
 ["duplicate omission",{selected_candidate_ids:["c1"],omissions:[{ids:["p0","p0"],reason:"background"}]},"summary_candidate_omissions"],
 ["selected also omitted",{selected_candidate_ids:["c1"],omissions:[{ids:["c1","p0"],reason:"background"}]},"summary_candidate_omissions"],
 ["unknown omission",{selected_candidate_ids:["c1"],omissions:[{ids:["p0","unknown"],reason:"background"}]},"summary_candidate_omissions"],
 ["unknown reason",{selected_candidate_ids:["c1"],omissions:[{ids:["p0"],reason:"unimportant"}]},"summary_candidate_omissions"],
 ["background with by",{selected_candidate_ids:["c1"],omissions:[{ids:["p0"],reason:"background",by:["c1"]}]},"summary_candidate_omissions"],
 ["replacement not selected",{selected_candidate_ids:["c1"],omissions:[{ids:["p0"],reason:"redundant",by:["p0"]}]},"summary_candidate_omissions"],
 ["narrow cannot cover full paragraph",{selected_candidate_ids:["c1"],omissions:[{ids:["p0"],reason:"covered",by:["c1"]}]},"summary_candidate_omission_scope"],
 ["budget cannot hide overlap",{selected_candidate_ids:["c1"],omissions:[{ids:["p0"],reason:"budget"}]},"summary_candidate_budget_reason"],
])test("omission ledger rejects "+name,()=>{
 const {input,plan}=paragraph();assert.throws(()=>result(plan,input,reply),{code});
});
test("supersession follows actual source position, independent of candidate ID or grouping",()=>{
 const input=textInput("**Assistant:** 先前判断：队列永远追不上。\n\n更正：旧计数含历史数据，不能据此推断新版队列。");
 const plan=planResponse(input,[{unit:1,quote:input.sources[0].units[1].text,event_id:"new",facet:"constraint"},
  {unit:0,quote:input.sources[0].units[0].text,event_id:"old",facet:"constraint"}]);
 const rendered=result(plan,input,{selected_candidate_ids:["c1"],omissions:[{ids:["c2"],reason:"superseded",by:["c1"]}]});
 assert.doesNotMatch(rendered.episode_summary,/永远追不上/);assert.match(rendered.episode_summary,/更正/);
 assert.equal(rendered.validation.model_omission_reasons_verified,false);
 assert.throws(()=>result(plan,input,{selected_candidate_ids:["c2"],omissions:[{ids:["c1"],reason:"superseded",by:["c2"]}]}),
  {code:"summary_candidate_omission_scope"});
});
test("omission replacement cannot borrow another source even when the words match",()=>{
 const input=buildFactInput([{text:"**Assistant:** 甲任务完成。\n\n甲曾失败。",source:"conversation"},
  {text:"**Assistant:** 乙任务完成。",source:"conversation"}],"2026-10-20"),plan=planResponse(input);
 assert.throws(()=>result(plan,input,{selected_candidate_ids:["c1","c3"],omissions:[{ids:["c2"],reason:"redundant",by:["c3"]}]}),
  {code:"summary_candidate_omission_scope"});
});
test("budget reason is verified against adding that candidate to the current body",()=>{
 for(const [size,accepted]of [[20,false],[5300,true]]){
  const input=textInput("**Assistant:** "+"背景".repeat(size)+"。\n\n最终任务完成。"),plan=planResponse(input);
  const selection={selected_candidate_ids:["c2"],omissions:[{ids:["c1"],reason:"budget"}]};
  if(accepted)assert.match(result(plan,input,selection).episode_summary,/最终任务完成/);
  else assert.throws(()=>result(plan,input,selection),{code:"summary_candidate_budget_reason"});
 }
});
test("budget reasons are rechecked during publication, not only on completion",()=>{
 const input=textInput("**Assistant:** 次要过程。\n\n最终完成。"),plan=planResponse(input);
 const response=completeCandidateSelection(plan,{selected_candidate_ids:["c2"],omissions:[{ids:["c1"],reason:"background"}]},input);
 response[EVENT_PLAN].selection.omissions[0].reason="budget";
 assert.throws(()=>validateAndRenderFacts(response,input),{code:"summary_candidate_budget_reason"});
});
test("alternatives count toward the complete input and pool limits without clipping",()=>{
 const {input,plan}=paragraph(),prompt=buildCandidateSelectionPrompt(plan,input,45000),n=prompt.system.length+prompt.prompt.length;
 assert.doesNotThrow(()=>buildCandidateSelectionPrompt(plan,input,n));
 assert.throws(()=>buildCandidateSelectionPrompt(plan,input,n-1),{code:"summary_plan_input_budget"});
 const many=textInput("**Assistant:** "+Array.from({length:257},(_,i)=>"事项"+i+"完成。仍有条件。").join("\n\n"));
 const large=planResponse(many,many.sources[0].units.map(u=>({unit:u.index,quote:"仍有条件。",event_id:"u"+u.index,facet:"constraint"})));
 assert.throws(()=>buildCandidateSelectionPrompt(large,many,1000000),{code:"summary_candidate_pool_budget"});
});
