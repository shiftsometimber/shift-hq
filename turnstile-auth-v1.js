(()=>{
  'use strict';
  const API=(window.SST_API_BASE||'https://api.shiftsometimber.co.uk').replace(/\/$/,'');
  const actions={
    '/auth/register':'member_register','/auth/login':'member_login','/auth/request-password-reset':'password_reset',
    '/v1/hq/auth/bootstrap':'hq_bootstrap','/v1/hq/auth/login':'hq_login'
  };
  let configPromise,scriptPromise;const widgets=new Map(),pending=new Map();
  async function config(){return configPromise||(configPromise=fetch(API+'/v1/auth/turnstile-config',{credentials:'include',cache:'no-store'}).then(r=>r.json()).catch(()=>({enabled:false,required:false,siteKey:''})))}
  function script(){if(window.turnstile)return Promise.resolve();return scriptPromise||(scriptPromise=new Promise((resolve,reject)=>{const s=document.createElement('script');s.src='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';s.async=true;s.defer=true;s.onload=resolve;s.onerror=()=>reject(Error('Security check could not load.'));document.head.appendChild(s)}))}
  async function getToken(action){const c=await config();if(!c.required)return'';if(!c.enabled||!c.siteKey)throw Error('Secure sign-in is temporarily unavailable.');await script();return new Promise((resolve,reject)=>{let box=widgets.get(action);if(!box){const node=document.createElement('div');node.className='sst-turnstile';node.setAttribute('aria-label','Security check');document.body.appendChild(node);const id=turnstile.render(node,{sitekey:c.siteKey,action,theme:'auto',execution:'execute',appearance:'interaction-only',callback:token=>{const p=pending.get(action);pending.delete(action);p?.resolve(token)},'error-callback':()=>{const p=pending.get(action);pending.delete(action);p?.reject(Error('Security check failed. Please try again.'))},'expired-callback':()=>{const p=pending.get(action);pending.delete(action);p?.reject(Error('Security check expired. Please try again.'))}});box={id,node};widgets.set(action,box)}pending.set(action,{resolve,reject});turnstile.reset(box.id);turnstile.execute(box.id)})}
  async function protect(path,data={}){const action=actions[path];if(!action)return data;const token=await getToken(action);return token?{...data,turnstileToken:token}:data}
  window.SSTTurnstile={protect,getToken,config};
})();
