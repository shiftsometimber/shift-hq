// Browser notice for the independent QA reviewer gate. This never signs in,
// changes a native session, sends a code or extends an Access assertion.
export function reviewerExpiry(){
 const expires=Number(document.currentScript?.dataset.reviewExpires)*1000;
 if(!Number.isSafeInteger(expires)||expires<=0)return;
 let cleared=false,timer;
 function check(){
  clearTimeout(timer);
  if(Date.now()<expires){timer=setTimeout(check,Math.min(2147483647,expires-Date.now()));return;}
  if(cleared)return;cleared=true;
  const main=document.createElement('main');main.setAttribute('role','alert');
  main.style.cssText='max-width:680px;margin:10vh auto;padding:28px;color:#E7E3DA;background:#050505;font:18px/1.6 system-ui';
  const heading=document.createElement('h1');heading.textContent='Reviewer sign-in has expired';
  const text=document.createElement('p');text.textContent='Your 30-minute test access has ended. Sign in again to continue reviewing the fictional records.';
  const link=document.createElement('a');link.textContent='Continue to secure sign-in';link.href=location.pathname+location.search;link.style.cssText='display:inline-block;padding:12px 18px;color:#050505;background:#E7E3DA;border-radius:6px';
  main.append(heading,text,link);document.body.replaceChildren(main);document.body.style.background='#050505';document.documentElement.dataset.qaReviewClearedAt=String(Date.now());
 }
 document.addEventListener('visibilitychange',check);window.addEventListener('pageshow',check);check();
}
export const REVIEWER_EXPIRY_CLIENT='('+reviewerExpiry.toString()+')();';
