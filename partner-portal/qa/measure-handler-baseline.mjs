// Diagnostic only: complete native handlers + SQLite, not browser/WAN speed.
import fs from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fullLoop} from './full-loop-scenario.mjs';
const sourceCommit=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
if(execFileSync('git',['diff','--name-only'],{encoding:'utf8'}).trim())throw Error('Commit source before measuring; no previous-head qualification');
const output=process.env.SSTRX_HANDLER_EVIDENCE||'.partner-qa/handler-baseline';
await fs.mkdir(output,{recursive:true});
const report={sourceCommit,scope:'SYNTHETIC_NATIVE_HANDLER_ONLY',startedAt:new Date().toISOString(),
 releasePerformanceQualified:false,warmSamplesPerAction:100,freshFixtureSamplesPerAction:20,
 unqualified:['Hosted browser click-to-usable','WAN/edge/server breakdown','Browser cold cache and sign-in','Physical iPhone/PWA and Android','Customer usefulness'],
 bundles:{},metrics:{},failures:[]};
for(const name of ['clinical','member','sstrx','native-programme']){
 const p=new URL('../../.partner-qa/'+name+'.bundle.mjs',import.meta.url);
 try{const bytes=await fs.readFile(p);report.bundles[name]={sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length};}catch{report.bundles[name]={unavailable:true};}
}
const summarise=samples=>{
 const sorted=samples.map(s=>s.elapsedMs).sort((a,b)=>a-b),n=sorted.length;
 return {n,successes:samples.filter(s=>s.ok).length,failures:samples.filter(s=>!s.ok).length,
  medianMs:n?(sorted[Math.floor((n-1)/2)]+sorted[Math.ceil((n-1)/2)])/2:null,
  p95Ms:n?sorted[Math.ceil(n*.95)-1]:null,samples};
};
async function context(){
 const f=await fullLoop({sstrxCandidate:true});
 try{
  if(!f.report.repeat||f.report.executionError)throw Error('Native prerequisite journey failed');
  const clinician=await f.login('clinician'),pharmacy=await f.login('dispenser'),id=f.created.id;
  return {f,actions:{
   operational_dashboard:()=>f.partner('/platform',clinician),
   clinical_queue:()=>f.partner('',clinician),
   open_assessment:()=>f.partner('/'+id,clinician),
   load_prescription:()=>f.partner('/prescriptions/'+id,clinician),
   pharmacy_status:()=>f.partner('/partners/fulfilment/'+f.report.firstOrder.orderNumber,pharmacy),
   authorised_search:()=>f.partner('/platform?q='+encodeURIComponent(f.report.firstOrder.orderNumber),clinician),
   safe_followup_write:()=>f.partner('/platform/followups',clinician,{recordId:id,kind:'review',dueAt:new Date(Date.now()+86400000).toISOString(),instructions:'FICTIONAL HANDLER PERFORMANCE SAMPLE'})
  }};
 }catch(error){f.s.close();throw error;}
}
async function sample(fn,index){
 const started=performance.now();let status=null,error=null;
 try{const response=await fn();status=response.status;await response.arrayBuffer();if(!response.ok)error='HTTP_'+status;}
 catch(cause){error=String(cause.message).slice(0,160);}
 return {index,elapsedMs:Number((performance.now()-started).toFixed(3)),status,ok:error===null,error};
}
const warm=await context();
try{
 for(const [name,fn] of Object.entries(warm.actions)){
  const samples=[];for(let i=0;i<100;i++)samples.push(await sample(fn,i));
  report.metrics[name]={warm:summarise(samples),freshFixture:{samples:[]}};
 }
}finally{warm.f.s.close();}
for(let i=0;i<20;i++){
 const fresh=await context();
 try{for(const [name,fn] of Object.entries(fresh.actions))report.metrics[name].freshFixture.samples.push(await sample(fn,i));}
 finally{fresh.f.s.close();}
}
for(const [name,value] of Object.entries(report.metrics)){
 value.freshFixture=summarise(value.freshFixture.samples);
 for(const state of ['warm','freshFixture'])for(const failed of value[state].samples.filter(s=>!s.ok))report.failures.push({name,state,...failed});
}
report.completedAt=new Date().toISOString();report.result=report.failures.length?'FAIL_HANDLER_DIAGNOSTIC':'PASS_HANDLER_DIAGNOSTIC_ONLY';
await fs.writeFile(output+'/results.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({...report,bundles:report.bundles,metrics:Object.fromEntries(Object.entries(report.metrics).map(([name,m])=>[name,Object.fromEntries(Object.entries(m).map(([state,{samples,...summary}])=>[state,summary]))]))}));
if(report.failures.length)process.exitCode=1;
