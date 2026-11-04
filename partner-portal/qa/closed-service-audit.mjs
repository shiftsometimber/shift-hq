import fs from 'node:fs';
import vm from 'node:vm';
import {webcrypto,createHash} from 'node:crypto';
if(!process.argv[2])throw Error('Usage: node closed-service-audit.mjs /path/to/captured-deployed-worker.js');
const source=fs.readFileSync(process.argv[2],'utf8');
const digest=createHash('sha256').update(source).digest('hex');
if(digest!=='b7bd886a5357222af1717f053959d608094dd32f07c072440166bf4998f5d3c5')throw Error('Unexpected deployed source snapshot');
const code=source.replace(/export\s*\{[\s\S]*?\};\s*\/\/# sourceMappingURL=[^\n]*\s*$/,'')+'\n;portal_release_worker_default;';
const worker=vm.runInNewContext(code,{Request,Response,Headers,URL,TextEncoder,TextDecoder,crypto:webcrypto,atob,btoa,Blob,FormData},{timeout:3000});
let dbCalls=0;
const env={PARTNER_ACCESS_ENABLED:'true',PARTNER_INTERNAL_SETUP_ONLY:'false',PARTNER_LOGIN_ENABLED:'true',PARTNER_FULFILMENT_ENABLED:'true',CLINICAL_CASEWORK_ENABLED:'true',CLINICAL_REVIEW_READY:'true',CLINICAL_CONTEXT_ENABLED:'true',PRESCRIPTION_SIGNING_ENABLED:'true',
HQ_AUTH:{async fetch(){return Response.json({user:{id:900001,role:'clinical',mfaEnabled:true,name:'Fictional audit professional'}})}},
DB:{prepare(){dbCalls++;throw Error('Unexpected database access in closed-scope audit')}}};
const id='00000000-0000-4000-8000-000000000001';
const trials=[['POST','/partners/login',503],['POST','/partners/login/verify',503],['GET','',503],['GET','/'+id,503],['POST','/partners/fulfilment/DEMO-1042/action',503],['GET','/partners/fulfilment',403]];
const results=[];
for(const [method,path,expected] of trials){
 const request=new Request('https://api.shiftsometimber.co.uk/v1/hq/clinical'+path,{method,headers:{Origin:'https://hq.shiftsometimber.co.uk',Cookie:'sst_hq_session=fictional-sandbox-token-0000000000000000','Content-Type':'application/json'},...(method==='POST'?{body:'{}'}:{})});
 const response=await worker.fetch(request,env);let body;try{body=await response.json()}catch{body={}};
 results.push({method,path,status:response.status,expected,error:body.error,pass:response.status===expected});
}
console.log('CLOSED_SCOPE_AUDIT='+JSON.stringify({source_sha256:digest,forced_environment_flags:'true in isolated sandbox only',network_requests:0,database_calls:dbCalls,results}));
if(dbCalls||results.some(x=>!x.pass))process.exitCode=1;
