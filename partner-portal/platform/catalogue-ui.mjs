import {rxHead,rxLogo} from './ui.mjs';
export const cataloguePage=()=>rxHead('Catalogue authorisation')+'<script type="module" src="/assets/catalogue.js"></script></head><body class="rx-app"><header class="rx-top"><a href="/workspace/clinical" aria-label="SST Rx clinical workspace">'+rxLogo+'</a></header><main class="rx-content"><p>CATALOGUE AUTHORISATION · TEST</p><h1>Review this commercial version</h1><p>Catalogue approval does not prescribe for a member. Patient assessment, prescribing and clinical messages remain in their existing Rx records.</p><p id="catalogue-review-status" role="status" aria-live="polite">Choose a catalogue item from HQ.</p><section id="catalogue-review-item"></section><form id="catalogue-review-form" hidden><label><input id="catalogue-acknowledge" type="checkbox" required> I approve this exact product and strength version within my authorised scope.</label><button type="submit" id="catalogue-approve">Record catalogue sign-off</button></form><p><a href="/workspace/clinical">Back to clinical workspace</a></p></main></body></html>';
export const CATALOGUE_CLIENT=String.raw`
const get=id=>document.getElementById(id),status=get('catalogue-review-status'),item=get('catalogue-review-item'),form=get('catalogue-review-form');
let current=null,serial=0,controller;
const node=(tag,text)=>{const n=document.createElement(tag);n.textContent=text;return n;};
const id=()=>location.hash.slice(1);
async function request(body){
 if(!/^[1-9]\d*$/.test(id()))throw Error('Open a valid item from HQ.');
 const r=await fetch('/api/clinical/platform/catalogue/'+id(),{method:body?'POST':'GET',credentials:'same-origin',cache:'no-store',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined,signal:controller.signal});
 const data=await r.json();if(!r.ok)throw Error(data.error||'Catalogue authorisation is unavailable.');return data;
}
async function refresh(){
 controller?.abort();controller=new AbortController();const ticket=++serial;current=null;form.hidden=true;item.replaceChildren();status.textContent='Checking your current professional scope and catalogue version…';
 try{const data=await request();if(ticket!==serial)return;current=data;const x=data.item;item.append(node('h2',x.name+' · '+x.strength_label),node('p','Product version '+x.product_version+' · Strength version '+x.catalogue_version),node('p','Commercial selling price: '+new Intl.NumberFormat('en-GB',{style:'currency',currency:'GBP'}).format(x.selling_price_pence/100)),node('p','Current sign-off: '+data.authority.signoff.status));form.reset();form.hidden=false;status.textContent='TEST catalogue. Your account, professional grant and exact version will be checked again when you record sign-off.';
 }catch(e){if(ticket===serial){current=null;item.replaceChildren();form.hidden=true;status.textContent=e.message;}}
}
form.addEventListener('submit',async event=>{event.preventDefault();if(!current||!get('catalogue-acknowledge').checked)return;const ticket=serial,button=get('catalogue-approve'),version={productVersion:current.item.product_version,variantVersion:current.item.catalogue_version,acknowledge:true};button.disabled=true;status.textContent='Recording this exact approval…';try{const data=await request(version);if(ticket!==serial)return;if(data.recorded!==true)throw Error('Approval receipt was not confirmed.');await refresh();status.textContent='Catalogue sign-off recorded. HQ can read the who, when and version metadata.';}catch(e){if(ticket===serial){current=null;form.hidden=true;status.textContent=e.message+' Refresh and inspect the current receipt before another attempt.';}}finally{button.disabled=false;}});
window.addEventListener('hashchange',refresh);window.addEventListener('pagehide',()=>{serial++;controller?.abort();current=null;item.replaceChildren();form.hidden=true;});refresh();
`;
