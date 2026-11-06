// Member-only fictional checkout. No payment card, external navigation or send.
export const QA_PRICE_HTML='<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Additional payment TEST · My Timber</title><style>body{margin:0;background:#050505;color:#E7E3DA;font:16px/1.5 system-ui}main{max-width:760px;margin:auto;padding:28px 22px}a{color:#B4C2A0}h1{font-size:32px;line-height:1.2}section{background:#10100E;padding:22px;margin:24px 0}button{font:600 16px/1.4 system-ui;padding:12px;margin:8px 12px 8px 0;background:#E7E3DA;color:#050505;border:0;cursor:pointer;min-height:44px}button:disabled{opacity:.6}button:focus-visible,a:focus-visible{outline:3px solid #B4C2A0;outline-offset:4px}#status{min-height:32px;color:#C9C3B6}</style><script defer src="/assets/clinical-records/qa-price-payment.js"></script></head><body><main><a href="/member/my-shift?view=orders">My Shift orders</a><p>FICTIONAL TEST CHECKOUT · NO REAL MONEY</p><h1>Agreed additional payment</h1><p>This records a fictional payment outcome for the existing agreed order. No card details should be entered. Payment does not approve treatment or release a supply.</p><section id="qa-price-checkout"><p>Checking your owned TEST payment…</p></section><p id="status" role="status" aria-live="polite"></p></main></body></html>';
function priceCheckoutClient(){
 const root=document.getElementById('qa-price-checkout'),status=document.getElementById('status'),id=location.pathname.split('/').pop(),path='/v1/member/clinical-records/qa-price-checkout/'+encodeURIComponent(id);
 let stopped=false,busy=false,expected=null,expiry;
 const node=(tag,text)=>{const n=document.createElement(tag);n.textContent=text;return n;};
 function clear(){stopped=true;clearTimeout(expiry);root.replaceChildren(node('p','Your private TEST checkout is closed. Sign in again to continue.'));status.textContent='';}
 async function api(body){
  const r=await fetch(path,{method:body?'POST':'GET',credentials:'same-origin',cache:'no-store',headers:{...body?{'Content-Type':'application/json'}:{},...expected!==null?{'X-My-Timber-Expected-Account':String(expected)}:{}},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(15000)});
  const d=await r.json();if(stopped)throw Error('Checkout closed');
  if(r.status===401||r.status===403||d.error==='account_changed'){clear();throw Error('Sign in again.');}
  if(!r.ok)throw Error(d.error==='qa_price_receipt_requires_reconciliation'?'The saved TEST receipt needs checking. Refresh this same checkout and reconcile its retained receipt.':'This TEST payment could not be confirmed. Refresh this same checkout before any further action.');
  if(expected!==null&&expected!==d.memberId){clear();throw Error('Account changed.');}expected=d.memberId;
  clearTimeout(expiry);if(d.sessionExpiresAt)expiry=setTimeout(clear,Math.min(2147483647,Math.max(0,Date.parse(d.sessionExpiresAt)-Date.now())));return d;
 }
 async function render(){
  const d=await api();root.replaceChildren(node('h2','Order '+d.orderReference),node('p','Additional TEST amount: '+new Intl.NumberFormat('en-GB',{style:'currency',currency:d.currency}).format(d.amountPence/100)),node('p','Native payment state: '+d.state.replaceAll('_',' ')),node('p','Retained simulated outcome: '+d.outcome.replaceAll('_',' ')));
  if(d.state==='paid')root.append(node('p','The native payment receipt and ledger are recorded. Clinical review, signing and pharmacy decisions remain separate.'));
  const actions=d.outcome==='open'&&['submitting','unknown','checkout_open'].includes(d.state)?[['complete','Simulate payment received'],['fail','Simulate confirmed payment failure'],['expire','Simulate checkout expiry']]:d.receiptPending?[['reconcile','Reconcile the saved TEST receipt']]:[];
  for(const[action,label]of actions){const b=node('button',label);b.type='button';b.onclick=async()=>{if(busy||stopped)return;busy=true;for(const button of root.querySelectorAll('button'))button.disabled=true;try{await api({action});status.textContent='Saved fictional outcome checked against the same native payment. No money moved.';await render();}catch(e){if(!stopped)status.textContent=e.message;}finally{busy=false;}};root.append(b);}
  const refresh=node('button','Refresh this TEST payment');refresh.type='button';refresh.onclick=()=>{if(!busy&&!stopped)render().catch(e=>{if(!stopped)status.textContent=e.message;});};root.append(refresh);
 }
 window.addEventListener('pagehide',clear);window.addEventListener('pageshow',e=>{if(e.persisted)location.reload();});
 render().catch(e=>{if(!stopped)status.textContent=e.message;});
}
export const QA_PRICE_CLIENT='('+priceCheckoutClient.toString()+')();';
