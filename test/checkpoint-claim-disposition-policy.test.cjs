"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const fs=require("node:fs"),path=require("node:path"),{createHash}=require("node:crypto");
const ledger=require("../lib/checkpoint/summary-claim-ledger.cjs");
const {buildFactInput}=require("../lib/checkpoint/ordinary-summary-facts");
function fixture(){
  const input=buildFactInput([{text:"报告维护正常。\n表头上下文。\n尚待运行证据。",role:"assistant",source:"conversation"}],"2026-10-20");
  const p=JSON.parse(ledger.buildClaimPrompt(input,{referenceMode:"fragment_ids"}).prompt),rows=p.SOURCE.sources[0].fragments;
  const wire={version:p.version,target_date:p.target_date,binding:p.binding,
    claims:[{id:"c1",scope:"本次维护",kind:"report",text:"报告维护正常",conditions:[],corrects:[],evidence:[rows[0][0]]}],
    dispositions:[{fragment:"unknown.l? ",reason:"unresolved",claim_ids:[]},
      {fragment:rows[0][0],reason:"context",claim_ids:[]},{fragment:rows[1][0],reason:"context",claim_ids:[]}]};
  return{input,wire};
}
test("invalid non-claim accounting remains strict by default; explicit findings mode retains raw wire and every fact",()=>{
  const f=fixture(),before=structuredClone(f.wire);
  assert.throws(()=>ledger.projectClaimLedger(f.input,f.wire,{referenceMode:"fragment_ids"}),{code:"claim_disposition"});
  const r=ledger.projectClaimLedger(f.input,f.wire,{referenceMode:"fragment_ids",dispositionPolicy:"quality_findings"});
  assert.deepEqual(f.wire,before);assert.deepEqual(r.ledger,before);assert.deepEqual(r.effective_ledger.claims,before.claims);
  assert.equal(r.effective_ledger.dispositions.length,1);assert.equal(r.disposition_findings.length,2);
  assert.equal(r.disposition_findings[0].disposition.fragment,"unknown.l? ");
  assert.deepEqual(r.disposition_findings.map(x=>x.problems),[["unknown_fragment"],["already_quoted"]]);
  assert.equal(r.coverage.unresolved_fragment_ids.length,0);assert.equal(r.semantic_correctness,"NOT_CERTIFIED");
  assert.equal(ledger.validateClaimLedger(f.input,r.effective_ledger,{referenceMode:"fragment_ids"}).ledger.claims.length,1);
});
test("findings mode never relaxes claim citations, correction graphs, disposition shape or source binding",()=>{
  for(const mode of ["evidence","correction","shape","binding"]){
    const f=fixture();
    if(mode==="evidence")f.wire.claims[0].evidence=["unknown.l0"];
    if(mode==="correction")f.wire.claims[0].corrects=["c999"];
    if(mode==="shape")f.wire.dispositions[0].extra="unexpected";
    if(mode==="binding")f.wire.binding="wrong";
    assert.throws(()=>ledger.validateClaimLedger(f.input,f.wire,{referenceMode:"fragment_ids",dispositionPolicy:"quality_findings"}));
  }
  assert.throws(()=>ledger.buildClaimPrompt(fixture().input,{dispositionPolicy:"ignore_all"}),{code:"claim_options"});
});
test("captured automatic inventory preserves strict failure while explicit accounting view keeps all literal claim evidence",{
  skip:process.env.MEMORY_ENGINE_TEST_AUTOMATIC_INVENTORY_DIRECTORY?false:"set MEMORY_ENGINE_TEST_AUTOMATIC_INVENTORY_DIRECTORY for strict failure evidence"
},()=>{
  const d=process.env.MEMORY_ENGINE_TEST_AUTOMATIC_INVENTORY_DIRECTORY,raw=fs.readFileSync(path.join(d,"inventory-model-output.json"));
  const wire=JSON.parse(raw),input=JSON.parse(fs.readFileSync(path.join(d,"fact-input.json")));
  const records=JSON.parse(fs.readFileSync(path.join(d,"input-records.json")));
  assert.throws(()=>ledger.validateClaimLedger(input,wire,{referenceMode:"fragment_ids"}),{code:"claim_disposition"});
  const r=ledger.projectClaimLedger(input,wire,{referenceMode:"fragment_ids",dispositionPolicy:"quality_findings",bodyMaxChars:200000});
  assert.deepEqual(r.ledger,wire);assert.deepEqual(r.effective_ledger.claims,wire.claims);
  assert.equal(r.disposition_findings.length,7);assert.equal(r.effective_ledger.dispositions.length,79);
  const sha=x=>createHash("sha256").update(x).digest("hex"),originals=new Map(records.map(x=>[sha(x.text),x.text]));
  for(const c of r.claims)for(const ref of c.sources)assert.equal(originals.get(ref.source_hash).slice(ref.start,ref.end),ref.quote);
  assert.deepEqual(fs.readFileSync(path.join(d,"inventory-model-output.json")),raw);
  assert.equal(r.semantic_correctness,"NOT_CERTIFIED");assert.equal(r.publishable,false);
});
