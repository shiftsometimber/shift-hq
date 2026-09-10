(()=>{
  'use strict';
  const API=(window.SST_API_BASE||'https://api.shiftsometimber.co.uk').replace(/\/$/,'');
  const actions={
    '/auth/register':'member_register','/auth/login':'member_login','/auth/request-password-reset':'password_reset',
    '/v1/hq/auth/bootstrap':'hq_bootstrap','/v1/hq/auth/login':'hq_login'
  };
  let configPromise,scriptPromise;const widgets=new Map(),pending=new Map();
  async function config(){return configPromise||(configPromise=fetch(API+'/v1/auth/turnstile-config',{credentials:'include',cache:'no-store'}).then(r=>r.json()).catch(()=>({enabled:false,required:false,siteKey:''})))}
  function script(){
    if(window.turnstile)return Promise.resolve();
    return scriptPromise||(scriptPromise=new Promise((resolve,reject)=>{
      const s=document.createElement('script');
      const timeout=setTimeout(()=>reject(Error('Security check timed out. Please try again.')),12000);
      s.src='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';s.async=true;s.defer=true;
      s.onload=()=>{clearTimeout(timeout);resolve()};
      s.onerror=()=>{clearTimeout(timeout);reject(Error('Security check could not load. Please try again.'))};
      document.head.appendChild(s);
    }).catch(error=>{scriptPromise=null;throw error}))
  }
  async function getToken(action){
    const c=await config();if(!c.required)return'';
    if(!c.enabled||!c.siteKey)throw Error('Secure sign-in is temporarily unavailable.');
    await script();
    return new Promise((resolve,reject)=>{
      const previous=pending.get(action);previous?.reject(Error('A newer sign-in attempt replaced this one.'));
      const finish=(method,value)=>{const p=pending.get(action);if(!p)return;pending.delete(action);clearTimeout(p.timeout);p[method](value)};
      let box=widgets.get(action);
      if(!box){
        const node=document.createElement('div');node.className='sst-turnstile';node.setAttribute('aria-label','Security check');document.body.appendChild(node);
        const id=turnstile.render(node,{sitekey:c.siteKey,action,theme:'auto',execution:'execute',appearance:'interaction-only',
          callback:token=>finish('resolve',token),
          'error-callback':()=>finish('reject',Error('Security check failed. Please try again.')),
          'expired-callback':()=>finish('reject',Error('Security check expired. Please try again.'))});
        box={id,node};widgets.set(action,box)
      }
      const timeout=setTimeout(()=>finish('reject',Error('Security check timed out. Please try again.')),15000);
      pending.set(action,{resolve,reject,timeout});
      try{turnstile.reset(box.id);turnstile.execute(box.id)}catch(error){finish('reject',error)}
    })
  }
  async function protect(path,data={}){const action=actions[path];if(!action)return data;const token=await getToken(action);return token?{...data,turnstileToken:token}:data}
  window.SSTTurnstile={protect,getToken,config};
})();
