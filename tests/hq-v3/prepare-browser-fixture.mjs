// Prepare exact HQ assets plus a read model produced by native synthetic Rx
// actions. This does not start a browser, server, supplier call or production run.
import {myShiftFixture,signedRxFixture} from '../../partner-portal/qa/my-shift-fixture.mjs';
import {hqOperatingPicture} from '../../partner-portal/service/hq-operating-picture.mjs';
import {readFileSync,writeFileSync,readdirSync,copyFileSync,mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
const root=fileURLToPath(new URL('../../',import.meta.url));
const output=resolve(root,'.qa-v3/dist');mkdirSync(output,{recursive:true});mkdirSync(resolve(root,'.qa-v3/.openai'),{recursive:true});
writeFileSync(resolve(root,'.qa-v3/.openai/hosting.json'),JSON.stringify({static:{directory:'dist'}}));
const f=await myShiftFixture();try{
 Object.assign(f.env,{HQ_V3_TEST_MODE:'true',SSTRX_ENVIRONMENT:'synthetic',STRIPE_MODE:'test',SSTRX_TEST_SIGNING:'true'});
 f.sql.prepare("UPDATE medicine_orders SET email='fictional-member@example.invalid',stripe_checkout_session_id='cs_test_V3_ONLY' WHERE id=1").run();
 const rx=await signedRxFixture(f),order='TEST-SHARED-1042';
 for(const [version,action]of [[0,'accept'],[1,'prepare'],[2,'dispensed'],[3,'dispatch'],[4,'delivery_exception']])await rx.call('/partners/fulfilment/'+order+'/action',rx.pharmacy,{version,action,carrier:'dpd',trackingNumber:'12345678901234',message:'FICTIONAL TEST receipt; no parcel or external transaction'});
 const data=await hqOperatingPicture(f.env,{id:1,role:'owner',internal:true});
 for(const file of readdirSync(root))if(/\.(js|css|html)$/.test(file))copyFileSync(resolve(root,file),resolve(output,file));
 writeFileSync(resolve(output,'index.html'),readFileSync(resolve(root,'index.html'),'utf8').replace('<head>','<head><script src="fixture.js"></script>'));
 const fixture=readFileSync(new URL('./browser-fixture.js',import.meta.url),'utf8').replace("const p=u.pathname,method=init.method||'GET';","const p=u.pathname,method=init.method||'GET';if(p==='/v1/hq/clinical/partner-desk/operations')return json("+JSON.stringify(data)+");");
 writeFileSync(resolve(output,'fixture.js'),fixture);
 writeFileSync(resolve(output,'phone.html'),'<!doctype html><html lang="en-GB"><meta charset="utf-8"><title>HQ 390px TEST evidence</title><style>body{margin:0;background:#e7e3da;color:#050505;font:16px Arial}h1{font-size:18px;margin:12px}iframe{display:block;width:405px;height:844px;border:1px solid #707762;margin:12px}</style><h1>FICTIONAL TEST · 390px content viewport · desktop browser emulation</h1><iframe title="HQ phone-size TEST build" src="/"></iframe></html>');
 writeFileSync(resolve(output,'canonical-test-projection.json'),JSON.stringify(data,null,2));
 console.log(JSON.stringify({prepared:output,partition:'TEST',external_writes:false,browser_run:false}));
}finally{f.close();}
