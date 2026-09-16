import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('./hq.js',import.meta.url),'utf8');
// Execute the exact production helper block, without network or a synthetic sign-in.
const block=source.slice(source.indexOf('    function radarCanReview(){'),source.indexOf('    function radarSummary(event){'));
function fixture({role='owner',confirm=true,fail=false,result={ok:true,status:'verified',message:'Fresh review required'}}={}){
 const calls=[],state={textContent:''},button={disabled:false},form={elements:{review_note:{value:'Original source checked'}}};
 const context={S:{me:{role}},URL,Date,Intl,esc:v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),confirm:question=>{calls.push({confirm:question});return confirm},radarCall:async(path,opts)=>{calls.push({path,...opts});if(fail)throw Error('forbidden');return result},loadRadar:async()=>calls.push({reload:true}),openRadarEvent:async id=>calls.push({open:id}),$:()=>state};
 vm.createContext(context);vm.runInContext(block,context);return{context,calls,state,button,form};
}
const changed={id:17,status:'published',content_package:{article_markdown:'Retained approved article'},source_change:{id:89,observed_at:'2026-09-16 10:15:00',source:'<img src=x onerror=alert(1)>',url:'javascript:alert(1)',observation:{headline:'</p><script>alert(1)</script>',evidence:[{title:'<img src=x>',url:'data:text/html,test'}]}}};
test('changed evidence is escaped and unsafe links are never emitted',()=>{
 const {context}=fixture(),html=context.radarSourceWarning(changed);
 assert.match(html,/Fresh|fresh/);assert.match(html,/&lt;img/);assert.match(html,/&lt;script/);assert.doesNotMatch(html,/<script|<img|href="javascript:|href="data:/);
 assert.match(html,/16 Sept 2026, 11:15 UK time/);assert.equal(context.radarObservedAt('bad'),'Not recorded');
 assert.equal(context.radarSourceUrl('https://user:secret@example.org'),null);assert.equal(context.radarSourceUrl('https://example.org/a'),'https://example.org/a');
});
test('review authority matches existing server roles; publication remains owner/admin only',()=>{
 for(const role of ['owner','admin','operations','editor','support','marketing','']){const {context}=fixture({role});assert.equal(context.radarCanReview(),['owner','admin','operations','editor'].includes(role));assert.equal(context.radarCanPublish(),['owner','admin'].includes(role));}
});
test('cancelled confirmation leaves published package unchanged and makes no API request',async()=>{
 const f=fixture({confirm:false}),event=structuredClone(changed);await f.context.startRadarSourceCorrection(event,f.form,f.state,f.button);
 assert.equal(f.calls.length,1);assert.match(f.calls[0].confirm,/stop being publicly published/);assert.deepEqual(event,changed);assert.equal(f.button.disabled,false);
});
test('confirmed correction makes one explicit request then reloads, without approval or publication',async()=>{
 const f=fixture(),event=structuredClone(changed);await f.context.startRadarSourceCorrection(event,f.form,f.state,f.button);
 const api=f.calls.filter(x=>x.path);assert.equal(api.length,1);assert.equal(api[0].path,'/v1/hq/radar/events/17/correct');assert.equal(api[0].method,'POST');assert.deepEqual(JSON.parse(api[0].body),{note:'Original source checked'});
 assert.equal(f.calls.filter(x=>x.reload).length,1);assert.equal(f.calls.filter(x=>x.open).length,1);assert.equal(f.state.textContent,'Fresh review required');assert.deepEqual(event,changed);
});
test('failed or unexpected correction response never claims success or destroys local content',async()=>{
 for(const options of [{fail:true},{result:{ok:true,status:'published',message:'Refresh required'}}]){const f=fixture(options),event=structuredClone(changed);await f.context.startRadarSourceCorrection(event,f.form,f.state,f.button);assert.match(f.state.textContent,/Correction failed/);assert.equal(f.button.disabled,false);assert.equal(f.calls.some(x=>x.reload),false);assert.deepEqual(event,changed);}
});
test('non-reviewers and unchanged rows cannot invoke correction',async()=>{
 for(const [options,event] of [[{role:'support'},changed],[{}, {...changed,source_change:null}]]){const f=fixture(options);await f.context.startRadarSourceCorrection(event,f.form,f.state,f.button);assert.deepEqual(f.calls,[]);}
});
