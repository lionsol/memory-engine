"use strict";
// Constructed fixtures only. Never expands quotes or repairs actual provider responses.
const assert=require("node:assert/strict");
function sourceView(packet) {
 return {...packet,sources:packet.sources.map(s=>({...s,units:packet.units.filter(r=>r[1]===s.id)
  .map(r=>({index:r[0],role:r[2],text:r[5].map(p=>p[0]).join("")}))}))};
}
function catalogReply(packet,facts) {
 const candidates=packet.units.flatMap(r=>[
  {id:"u"+r[0],unit:r[0],quote:r[5].map(p=>p[0]).join("")},
  ...r[5].filter(p=>p[1]).map(p=>({id:p[1],unit:r[0],quote:p[0].trim()}))]);
 facts??=packet.units.map(r=>({unit:r[0],quote:r[5].map(p=>p[0]).join("")}));
 const selected=facts.map(f=>{
  const c=candidates.find(c=>c.unit===f.unit&&c.quote===f.quote);
  assert.ok(c,"fixture quote is not an exact catalog candidate");
  const facet=f.facet??"outcome",kind=f.kind??"report",row=[c.id];
  if(facet!=="outcome"||kind!=="report")row.push(facet);
  if(kind!=="report")row.push(kind);
  return row;
 });
 return {protocol:packet.protocol,target_date:packet.target_date,selected};
}
module.exports={sourceView,catalogReply};
