"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs");
const {join}=require("node:path"),{tmpdir}=require("node:os");
const {createRawLogReader}=require("../lib/checkpoint/raw-log-assembly");
const budget=require("../lib/checkpoint/raw-log-budget");
const {dedupeCollectedLogs}=require("../lib/checkpoint/raw-log-dedupe");
const {withRuntime}=require("../lib/checkpoint/runtime");
const llm=require("../lib/checkpoint/llm"),config=require("../lib/checkpoint/config");
const {withFakeHttps,emitJson,completion}=require("./checkpoint-summary-http-fixture.cjs");
// The subject is the real bin, reader and publisher. Unrelated confidence DB writes
// are counted at their boundary; every filesystem target is inside a fresh temp root.
const confidence=require("../lib/checkpoint/confidence-writer");
const originalConfidence=confidence.writeConfidence;
let binds=[],onBind=null;
confidence.writeConfidence=(...args)=>{binds.push(args[0]);onBind?.();return {status:"pending"};};
const checkpoint=require("../bin/session-checkpoint");
confidence.writeConfidence=originalConfidence;
const DATE="2026-10-20";
const BASE={maxFinalCombinedChars:40000,smartAddChars:16000,conversationChars:24000,
 perSessionChars:8000,toolSummaryChars:4000};
const ALIGNED={...BASE,perSessionChars:24000,conversationChars:25000};
const entry=(size,id)=>({text:"**User:** "+id+" "+"A".repeat(size-11-id.length),
 entryId:id,sessionId:id,category:"raw_log",provenance:"session_flush",source:"conversation",
 sourceKind:"smartAdd",timestampMs:null,role:"other",dedupeKey:id});
const answer=()=>({smart_memories:[],episode_summary:"Complete controlled ordinary-path summary.",configs:[]});
function stats(){
 const chars=()=>({smartAdd:0,dbRawLog:0,resetTranscript:0});
 return {droppedDuplicateCount:0,droppedByBudgetCount:0,sourceCharCountsAfter:chars(),
  charsBySourceAfterBudget:chars(),charsByRoleAfterBudget:{metadata_header:0,note:0,user:0}};
}
function makeReader(state,limits){
 return createRawLogReader({...budget,getRuntime:()=>({timeZone:"Asia/Shanghai",now:()=>Date.now()}),
  yesterdayDateStr:()=>DATE,getTargetDateRange:()=>({}),makeCollectorStats:stats,
  getBudgetConfig:()=>({...limits}),collectSmartAddLogs:()=>{
   if(state.unreadable)throw Error("private source unavailable");
   return state.entries.map(e=>({...e}));
  },collectDbRawLogs:()=>[],collectSessionTranscriptLogs:()=>[],dedupeCollectedLogs,
  inferRoleKey:()=>"user",logger:{log(){}}});
}
async function fixture(action){
 const root=fs.mkdtempSync(join(tmpdir(),"checkpoint-ordinary-")),episodes=join(root,"episodes");
 fs.mkdirSync(episodes);const path=join(episodes,DATE+".md");fs.writeFileSync(path,"OLD SUMMARY");
 const state={entries:[entry(22932,"long"),entry(366,"one"),entry(356,"two"),entry(360,"three")]};
 const read=makeReader(state,ALIGNED);
 const runtime={workspaceDir:root,memoryDir:root,episodesDir:episodes,smartAddDir:join(root,"smart"),
  generatedSmartAddDir:join(root,"generated"),sessionsDir:join(root,"sessions"),coreDbPath:join(root,"core"),
  engineDbPath:join(root,"engine"),configJsonPath:join(root,"absent.json"),lancedbDir:join(root,"lance"),
  timeZone:"Asia/Shanghai",checkpointLegacyDailyMirror:false,
  summaryTransport:async()=>{throw Error("segmented path must not run");}};
 binds=[];onBind=null;
 try{return await withRuntime(runtime,()=>action({state,read,path,root,episodes,runtime}));}
 finally{onBind=null;fs.rmSync(root,{recursive:true,force:true});}
}
async function run(logs,extract,extra={}){
 return withRuntime({llmNightlyExtract:extract},()=>checkpoint.nightlyCheckpoint(logs,{
  targetDate:DATE,rawLogStats:logs.checkpointStats,inputReady:true,...extra}));
}
function noDerived(root){
 assert.equal(fs.existsSync(join(root,"generated")),false);assert.equal(binds.length,0);
}
test("recorded four lengths replay baseline, session-only adjustment and aligned budgets without changing defaults",async()=>{
 await fixture(async({state})=>{
  for(const [limits,count,complete,lastChars] of [
   [BASE,9097,false,8000],[{...BASE,perSessionChars:24000},24000,false,331],[ALIGNED,24029,true,null]]){
   const logs=makeReader(state,limits)({targetDate:DATE});
   assert.equal(logs.checkpointStats.charsBeforeBudget,24029);
   assert.equal(logs.checkpointStats.charsAfterBudget,count);
   assert.equal(logs.checkpointStats.budgetCoverageComplete,complete);
   if(lastChars!==null)assert.equal(logs.checkpointStats.budgetUncoveredEntries[0].included_chars,lastChars);
  }
  const defaults=budget.getBudgetConfig({budgets:{...BASE}});
  assert.equal(defaults.perSessionChars,8000);assert.equal(defaults.conversationChars,24000);
 });
});
test("aligned budget goes through existing ordinary reader/bin/LLM HTTP path once with every full entry",async()=>{
 await fixture(async({state,read,path})=>{
  const logs=read({targetDate:DATE});assert.equal(logs.checkpointStats.budgetCoverageComplete,true);
  assert.equal(logs[0].text.length,22932);
  const oldRequest=config.resolveCheckpointLlmRequestConfig,oldProviders=config.resolveCheckpointProviders;
  config.resolveCheckpointLlmRequestConfig=()=>oldRequest({});
  config.resolveCheckpointProviders=()=>oldProviders({});
  let requests=0;
  try{
   await withFakeHttps(async()=>{
    const result=await run(logs,llm.llmNightlyExtract);
    assert.equal(result.status,"valid_summary");assert.equal(result.episode,true);
    assert.equal(result.source_version_valid,true);assert.equal(result.publication.published,true);
    assert.equal(fs.readFileSync(result.publication.backup,"utf8"),"OLD SUMMARY");
    assert.match(fs.readFileSync(path,"utf8"),/Complete controlled ordinary-path summary/);
   },(request,callback)=>{
    requests++;const prompt=request.body.messages.at(-1).content;
    for(const e of state.entries)assert.ok(prompt.includes(e.text),"full entry missing");
    assert.equal(request.body.max_tokens,4096);
    emitJson(callback,completion(JSON.stringify(answer())),{bytewise:true});
   });
  }finally{config.resolveCheckpointLlmRequestConfig=oldRequest;config.resolveCheckpointProviders=oldProviders;}
  assert.equal(requests,1);
 });
});
test("source changes during LLM preserve old episode before any derived write",async()=>{
 await fixture(async({state,read,path,root})=>{
  const logs=read({targetDate:DATE});
  const result=await run(logs,async()=>{state.entries[0].text+="changed";return answer();});
  assert.equal(fs.readFileSync(path,"utf8"),"OLD SUMMARY");noDerived(root);
  assert.equal(result.status,"input_incomplete");assert.equal(result.reason,"source_version_changed");
  assert.equal(result.source_version_valid,false);assert.equal(result.episode,false);
 });
});
test("episode changes during LLM preserve concurrent content before any derived write",async()=>{
 await fixture(async({read,path,root})=>{
  const logs=read({targetDate:DATE});
  const result=await run(logs,async()=>{fs.writeFileSync(path,"CONCURRENT SUMMARY");return answer();});
  assert.equal(fs.readFileSync(path,"utf8"),"CONCURRENT SUMMARY");noDerived(root);
  assert.equal(result.status,"publication_incomplete");assert.equal(result.reason,"episode_version_changed");
  assert.equal(result.episode,false);assert.equal(result.publication.published,false);
 });
});
test("observed concurrent emptying is preserved even if LLM throws or returns a timeout payload",async()=>{
 for(const mode of ["throw","timeout"]){
  await fixture(async({read,path,root})=>{
   const logs=read({targetDate:DATE});
   const result=await run(logs,async()=>{
    fs.writeFileSync(path,"");if(mode==="throw")throw Error("controlled failure");
    return {error:"llm超时"};
   });
   assert.equal(result.status,"publication_incomplete");assert.equal(result.reason,"episode_version_changed");
   assert.equal(fs.readFileSync(path,"utf8"),"");noDerived(root);
  });
 }
});
test("source read failure while extracting is not a successful snapshot and writes no marker",async()=>{
 await fixture(async({state,read,path,root})=>{
  const logs=read({targetDate:DATE});
  const result=await run(logs,async()=>{state.unreadable=true;return answer();});
  assert.equal(result.status,"input_incomplete");assert.equal(result.reason,"source_version_unavailable");
  assert.equal(fs.readFileSync(path,"utf8"),"OLD SUMMARY");noDerived(root);
 });
});
test("pre-call source/date mismatch refuses without invoking LLM",async()=>{
 await fixture(async({read,path,root})=>{
  const logs=read({targetDate:DATE});let calls=0;
  const result=await run(logs,async()=>{calls++;return answer();},{targetDate:"2026-10-19"});
  assert.equal(calls,0);assert.equal(result.source_version_valid,false);
  assert.equal(fs.readFileSync(path,"utf8"),"OLD SUMMARY");noDerived(root);
 });
});
test("legacy direct caller without collector evidence is protected against observed input-object mutation",async()=>{
 await fixture(async({path,root})=>{
  const logs=[{category:"raw_log",source:"conversation",text:"**User:** original input"}];
  const result=await run(logs,async()=>{logs[0].text+="changed";return answer();});
  assert.equal(result.reason,"source_version_changed");assert.equal(fs.readFileSync(path,"utf8"),"OLD SUMMARY");
  noDerived(root);
 });
});
test("initially absent episode created during LLM is not overwritten",async()=>{
 await fixture(async({read,path,root})=>{
  fs.unlinkSync(path);const logs=read({targetDate:DATE});
  const result=await run(logs,async()=>{fs.writeFileSync(path,"ANOTHER FIRST SUMMARY");return answer();});
  assert.equal(result.reason,"episode_version_changed");
  assert.equal(fs.readFileSync(path,"utf8"),"ANOTHER FIRST SUMMARY");noDerived(root);
 });
});
for(const change of ["episode","source"]){
 test("publisher rechecks "+change+" after episodic smart-add; existing cross-store partial-write boundary stays explicit",async()=>{
  await fixture(async({state,read,path,root,episodes})=>{
   const logs=read({targetDate:DATE});onBind=()=>{
    if(change==="episode")fs.writeFileSync(path,"LATE CONCURRENT SUMMARY");
    else state.entries[1].text+="changed";
   };
   const result=await run(logs,async()=>answer());
   assert.equal(result.status,change==="source"?"input_incomplete":"publication_incomplete");
   assert.equal(result.reason,change+"_version_changed");assert.equal(result.publication.published,false);
   assert.equal(fs.readFileSync(path,"utf8"),change==="episode"?"LATE CONCURRENT SUMMARY":"OLD SUMMARY");
   assert.equal(fs.readdirSync(join(root,"generated")).filter(name=>name.endsWith(".md")).length,1);
   assert.equal(result.writes.file_written,1);assert.equal(result.episode,false);
   assert.deepEqual(fs.readdirSync(episodes),[DATE+".md"]);
  });
 });
}

test("invalid destination snapshot refuses before LLM and does not claim a source-version check",async()=>{
 await fixture(async({read,path,root})=>{
  fs.unlinkSync(path);fs.writeFileSync(join(root,"external.md"),"UNCHANGED TARGET");
  fs.symlinkSync("../external.md",path);let calls=0;
  const result=await run(read({targetDate:DATE}),async()=>{calls++;return answer();});
  assert.equal(calls,0);assert.equal(result.status,"publication_incomplete");
  assert.equal(result.reason,"episode_version_unavailable");assert.equal(result.source_version_valid,null);
  assert.equal(fs.readFileSync(path,"utf8"),"UNCHANGED TARGET");noDerived(root);
 });
});

test("ordinary publication lock failure is reported rather than overwriting or claiming a valid summary",async()=>{
 await fixture(async({read,path})=>{
  fs.writeFileSync(path+".checkpoint.lock","held");
  const result=await run(read({targetDate:DATE}),async()=>answer());
  assert.equal(result.status,"publication_incomplete");assert.equal(result.publication.published,false);
  assert.equal(fs.readFileSync(path,"utf8"),"OLD SUMMARY");
 });
});
async function runMain(read,runtime,extract){
 return withRuntime({...runtime,readCheckpointRawLogs:read,llmNightlyExtract:extract,
  flushCheckpointRawLog:()=>({ok:true}),
  syncCoreMemoryIndex:()=>({ok:true,index_invocation:{status:"succeeded"},
   target_date_coverage:{status:"complete",target_date:DATE,path:"memory/smart-add/"+DATE+".md",
    required_fingerprints:4,matched_fingerprints:4,missing_fingerprints:0}}),
  reconcileSessionFlushManagedState:()=>({ok:true,target_date_input_complete:true,eligibleCoreRows:[]}),
  repairOrphanVectors:()=>({lance_membership_complete:true,lance_vector_validation_complete:true}),
  resolveConfigConflicts:()=>0},()=>checkpoint.main(["--target-date",DATE]));
}
for(const change of ["source","episode"]){
 test("main propagates ordinary "+change+" conflict as failed business status",async()=>{
  await fixture(async({state,read,path,runtime})=>{
   const result=await runMain(read,runtime,async()=>{
    if(change==="source")state.entries[0].text+="changed";else fs.writeFileSync(path,"NEW");
    return answer();
   });
   assert.equal(result.ok,false);assert.equal(result.businessStatus.business_complete,false);
   assert.equal(result.businessStatus.publication_complete,false);
   assert.equal(result.businessStatus.summary_input_complete,change!=="source");
   assert.equal(result.businessStatus.summary_status,change==="source"?"input_incomplete":"publication_incomplete");
  });
 });
}
test("committed episode with failed lock cleanup remains recorded as published, while main returns failure",async()=>{
 await fixture(async({read,path,runtime})=>{
  const unlink=fs.unlinkSync;
  fs.unlinkSync=function(p,...args){if(p===path+".checkpoint.lock")throw Object.assign(Error("fixture"),{code:"EIO"});return unlink.call(this,p,...args);};
  try{
   const result=await runMain(read,runtime,async()=>answer());
   assert.equal(result.ok,false);assert.equal(result.businessStatus.business_complete,false);
   assert.equal(result.businessStatus.publication_complete,false);
   assert.equal(result.businessStatus.ordinary_publication.published,true);
   assert.equal(result.businessStatus.ordinary_publication.cleanup_complete,false);
   assert.match(fs.readFileSync(path,"utf8"),/Complete controlled ordinary-path summary/);
  }finally{fs.unlinkSync=unlink;}
 });
});
