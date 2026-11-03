"use strict";
// Self-contained derived-memory archive. No model, runtime publisher or database.
const fs=require("node:fs"),path=require("node:path"),{createHash,randomUUID}=require("node:crypto");
const {buildFactInput}=require("./ordinary-summary-facts");
const lab=require("./summary-comparison-lab.cjs");
const VERSION="checkpoint-summary-archive-v1";
const digest=value=>createHash("sha256").update(value).digest("hex");
const hash=value=>digest(JSON.stringify(value));
const fail=code=>{throw Object.assign(new Error(code),{code});};
const str=value=>typeof value==="string"&&value.trim().length>0&&value.isWellFormed();
const isId=value=>typeof value==="string"&&/^[a-f0-9]{64}$/.test(value);
const copy=value=>JSON.parse(JSON.stringify(value));
const policy={kind:"derived_summary",lossy:true,semantic_correctness:"NOT_CERTIFIED",
 quality_findings_blocking:false,source_required_for:["execution","exact_parameters","disputed_claims"]};
function verifyArchive(archive,expectedId=archive?.archive_id){
 if(!archive||!isId(archive.archive_id)||archive.archive_id!==expectedId||
  Object.keys(archive).length!==2||!archive.payload||hash(archive.payload)!==archive.archive_id)fail("archive_integrity");
 const p=archive.payload;
 if(p.version!==VERSION||!str(p.created_at)||!Number.isFinite(Date.parse(p.created_at))||
  !p.generator||!str(p.generator.model)||!Array.isArray(p.raw_records)||!Array.isArray(p.source_map)||
  !Array.isArray(p.quality_findings)||p.quality_findings.some(f=>!str(f))||
  JSON.stringify(p.policy)!==JSON.stringify(policy))fail("archive_schema");
 if(p.previous_archive_id!==null&&!isId(p.previous_archive_id))fail("archive_schema");
 const sources=p.input?.sources;
 if(!Array.isArray(sources)||sources.length!==p.source_map.length)fail("archive_source");
 const seen=new Set(),recordIndexes=new Set(),units=new Map();
 for(const source of sources){
  if(!str(source.id)||seen.has(source.id))fail("archive_source");seen.add(source.id);
  const matches=p.source_map.filter(m=>m.source_id===source.id);
  if(matches.length!==1)fail("archive_source");
  const i=matches[0].record_index,record=p.raw_records[i];
  if(!Number.isSafeInteger(i)||i<0||i>=p.raw_records.length||recordIndexes.has(i)||!str(record?.text)||
   source.source_hash!==digest(record.text)||!Array.isArray(source.units))fail("archive_source");
  recordIndexes.add(i);
  for(const unit of source.units){
   if(!str(unit.id)||units.has(unit.id)||!str(unit.text)||!str(unit.role)||
    !Number.isSafeInteger(unit.start)||!Number.isSafeInteger(unit.end)||unit.start<0||
    unit.end>record.text.length||unit.end<=unit.start||
    record.text.slice(unit.start,unit.end)!==unit.text)fail("archive_source_range");
   units.set(unit.id,{source,unit,record_index:i});
  }
 }
 if(p.raw_records.filter(r=>str(r?.text)).length!==recordIndexes.size)fail("archive_source");
 for(const {source,unit} of units.values()){
  if(unit.context_ref!==undefined&&units.get(unit.context_ref)?.source.id!==source.id)fail("archive_source_context");
 }
 if(p.batches)require("./derived-summary-batches.cjs").verifyBatchInfo(p.batches,p.input,p.summary);
 const rendered=lab.validateSummary(p.input,p.summary,p.summary_max_chars,{allowDuplicateReferences:true,
  maxItems:p.batches?p.batches.total*256:256});
 if(rendered.body!==p.body)fail("archive_body");
 return {units,rendered};
}
function createArchive({rawLogs,targetDate,summary,generator,createdAt=new Date().toISOString(),
 previousArchiveId=null,qualityFindings=[],summaryMaxChars=20000,sourceInput,batchInfo}){
 if(!Array.isArray(rawLogs)||!generator||!str(generator.model)||!Array.isArray(qualityFindings))fail("archive_input");
 const records=copy(Array.from(rawLogs)),segmented=rawLogs.segmentedInput?copy(rawLogs.segmentedInput):null;
 const logs=copy(records);if(segmented!==null)logs.segmentedInput=segmented;
 const input=sourceInput?copy(sourceInput):buildFactInput(logs,targetDate),
  rendered=lab.validateSummary(input,summary,summaryMaxChars,{allowDuplicateReferences:true,maxItems:batchInfo?batchInfo.total*256:256});
 const referenceFindings=summary.items.flatMap((item,index)=>["evidence","corrects"].flatMap(field=>{
  const duplicates=item[field].length-new Set(item[field]).size;
  return duplicates?["Duplicate reference IDs retained: item="+index+"; field="+field+"; extra="+duplicates]:[];
 }));
 const indexes=records.map((record,index)=>str(record?.text)?index:null).filter(i=>i!==null);
 const payload={version:VERSION,created_at:createdAt,generator:copy(generator),previous_archive_id:previousArchiveId,
  policy:copy(policy),raw_records:records,segmented_input:segmented,input,
  source_map:input.sources.map((s,i)=>({source_id:s.id,record_index:indexes[i]})),
  summary:copy(summary),body:rendered.body,summary_max_chars:summaryMaxChars,quality_findings:copy([...qualityFindings,...referenceFindings])};
 if(batchInfo)payload.batches=copy(batchInfo);
 const archive={archive_id:hash(payload),payload};verifyArchive(archive);return archive;
}
function filePath(directory,id){
 if(!isId(id))fail("archive_id");return path.join(directory,id+".json");
}
function loadArchive(directory,id){
 const file=filePath(directory,id),stat=fs.lstatSync(file);
 if(!stat.isFile()||stat.isSymbolicLink())fail("archive_not_regular");
 const archive=JSON.parse(fs.readFileSync(file,"utf8"));verifyArchive(archive,id);return archive;
}
function persistArchive(directory,archive){
 verifyArchive(archive);
 fs.mkdirSync(directory,{recursive:true,mode:0o700});
 if(archive.payload.previous_archive_id!==null)loadArchive(directory,archive.payload.previous_archive_id);
 const target=filePath(directory,archive.archive_id),temp=target+"."+randomUUID()+".tmp";
 let fd;
 try{
  fd=fs.openSync(temp,"wx",0o600);fs.writeFileSync(fd,JSON.stringify(archive)+"\n");fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;
  // Atomic no-clobber publication; never overwrite or repair an existing archive.
  try{fs.linkSync(temp,target);}catch(error){if(error.code!=="EEXIST")throw error;}
  const directoryFd=fs.openSync(directory,"r");
  try{fs.fsyncSync(directoryFd);}finally{fs.closeSync(directoryFd);}
  const stored=loadArchive(directory,archive.archive_id);
  if(JSON.stringify(stored)!==JSON.stringify(archive))fail("archive_conflict");
  return {status:"TRACEABLE_DERIVED_MEMORY",archive_id:archive.archive_id,path:target,
   body_chars:archive.payload.body.length,semantic_correctness:"NOT_CERTIFIED",
   quality_findings:[...archive.payload.quality_findings]};
 }finally{
  if(fd!==undefined)fs.closeSync(fd);
  try{fs.unlinkSync(temp);}catch(error){if(error.code!=="ENOENT")throw error;}
 }
}
function resolveItem(directory,id,itemIndex){
 const archive=loadArchive(directory,id),{units}=verifyArchive(archive),p=archive.payload,item=p.summary.items[itemIndex];
 if(!Number.isSafeInteger(itemIndex)||itemIndex<0||!item)fail("archive_item");
 return {archive_id:id,item_index:itemIndex,item:copy(item),generator:copy(p.generator),policy:copy(p.policy),
  quality_findings:[...p.quality_findings],
  sources:[...new Set([...item.evidence,...item.corrects])].map(unitId=>{
   const {source,unit,record_index}=units.get(unitId),context=units.get(unit.context_ref)?.unit;
   return {locator:{archive_id:id,item_index:itemIndex,source_id:source.id,unit_id:unitId,record_index,start:unit.start,end:unit.end},
    entry_id:source.entry_id,source_hash:source.source_hash,source:source.source,provenance:source.provenance,
    collected_timestamp_ms:source.collected_timestamp_ms,role:unit.role,quote:unit.text,
    context:context?{unit_id:context.id,quote:context.text,start:context.start,end:context.end}:null,
    referenced_as:["evidence","corrects"].filter(field=>item[field].includes(unitId))};
  })};
}
function readOriginalRecord(directory,id,sourceId){
 const archive=loadArchive(directory,id),p=archive.payload,source=p.input.sources.find(s=>s.id===sourceId);
 if(!source)fail("archive_source_id");
 const index=p.source_map.find(m=>m.source_id===sourceId).record_index;
 return {archive_id:id,source_id:sourceId,source_hash:source.source_hash,record_index:index,record:copy(p.raw_records[index])};
}
module.exports={VERSION,createArchive,verifyArchive,persistArchive,loadArchive,resolveItem,readOriginalRecord};
