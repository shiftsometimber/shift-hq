import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {REVIEWER_EXPIRY_CLIENT} from '../qa/reviewer-expiry.mjs';

function fixture(){
 let time=1000000,job,requests=0;const events={};
 const element=tag=>({tag,style:{},children:[],setAttribute(k,v){this[k]=v},append(...items){this.children.push(...items)}});
 const document={currentScript:{dataset:{reviewExpires:1001}},documentElement:{dataset:{}},body:{children:['fictional private record'],style:{},replaceChildren(...items){this.children=items}},createElement:element,addEventListener(k,fn){events[k]=fn}};
 const context={document,window:{addEventListener(k,fn){events[k]=fn}},location:{pathname:'/member/my-shift',search:'?view=documents'},Date:{now:()=>time},setTimeout(fn,ms){job={fn,ms};return 1},clearTimeout(){},fetch(){requests++;throw Error('No authentication or transport permitted')}};
 vm.runInNewContext(REVIEWER_EXPIRY_CLIENT,context);
 return {document,events,job:()=>job,setTime:v=>{time=v},requests:()=>requests};
}
test('QA reviewer expiry clears the displayed private record at the verified deadline without extending or signing into anything',()=>{
 const f=fixture();assert.deepEqual(f.document.body.children,['fictional private record']);assert.equal(f.job().ms,1000);
 f.setTime(1001000);f.job().fn();const main=f.document.body.children[0];assert.equal(main.role,'alert');assert.equal(main.children[0].textContent,'Reviewer sign-in has expired');assert.equal(main.children[2].href,'/member/my-shift?view=documents');assert.equal(f.document.documentElement.dataset.qaReviewClearedAt,'1001000');assert.equal(f.requests(),0);
 const original=main;f.events.pageshow();assert.equal(f.document.body.children[0],original);
});
test('QA reviewer expiry rechecks the deadline on return after a throttled background timer',()=>{
 const f=fixture();f.setTime(1005000);f.events.visibilitychange();assert.equal(f.document.body.children[0].children[0].textContent,'Reviewer sign-in has expired');assert.equal(f.requests(),0);
});
