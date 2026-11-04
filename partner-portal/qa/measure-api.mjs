// Internal handler timings: native password/MFA, SQLite and crypto; NOT network/user-facing timings.
import fs from 'node:fs/promises';
import {fullLoop} from './full-loop-scenario.mjs';
const f=await fullLoop({sstrxCandidate:true}),{report}=f;
if(!report.repeat||report.executionError)throw Error('Native prerequisite journey failed');
const stats=a=>{const s=[...a].sort((a,b)=>a-b);return {n:s.length,medianMs:Math.round(((s.length%2?s[Math.floor(s.length/2)]:(s[s.length/2-1]+s[s.length/2])/2))*100)/100,p95Ms:Math.round(s[Math.ceil(s.length*.95)-1]*100)/100,samplesMs:a}};
const metrics={};const measure=async(name,fn,n=20)=>{const a=[];for(let i=0;i<n;i++){const t=performance.now();const response=await fn();await response.arrayBuffer();if(!response.ok)throw Error(name+' '+response.status);a.push(Math.round((performance.now()-t)*1000)/1000)}metrics[name]=stats(a)};
const cookie=await f.login('clinician'),pharmacy=await f.login('dispenser'),id=f.created.id;
await measure('authenticated_operational_dashboard',()=>f.partner('/platform',cookie));
await measure('clinical_work_queue',()=>f.partner('',cookie));
await measure('open_assessment',()=>f.partner('/'+id,cookie));
await measure('load_prescription',()=>f.partner('/prescriptions/'+id,cookie));
await measure('retrieve_pharmacy_order_status',()=>f.partner('/partners/fulfilment/'+report.firstOrder.orderNumber,pharmacy));
await measure('search_authorised_records',()=>f.partner('/platform?q='+encodeURIComponent(report.firstOrder.orderNumber),cookie));
await measure('save_followup_action',()=>f.partner('/platform/followups',cookie,{recordId:id,kind:'review',dueAt:new Date(Date.now()+86400000).toISOString(),instructions:'FICTIONAL PERFORMANCE SAMPLE'}));
const output={environment:'Node 24 native handler acceptance in managed Linux; in-memory SQLite, genuine test password/TOTP/WebAuthn; no network or supplier time',metrics,notMeasured:['real login over HTTPS','live supplier response','live save round trip','WebKit/Safari device timings']};
await fs.writeFile(new URL('../../.partner-qa/api-performance.json',import.meta.url),JSON.stringify(output,null,2)+'\n');console.log(JSON.stringify({metrics:Object.fromEntries(Object.entries(metrics).map(([k,{samplesMs,...s}])=>[k,s]))}));f.s.close();
