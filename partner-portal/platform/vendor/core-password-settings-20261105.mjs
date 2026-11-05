const passwordCard = `<div class="tracker-card" data-member-password-settings><h3 id="member-password-heading">Password</h3><p>We'll email a secure reset link to the email address on your My Timber account. The link expires after 30 minutes.</p><form id="memberPasswordReset" aria-labelledby="member-password-heading" tabindex="-1"><button class="btn btn-primary" type="submit" aria-describedby="memberPasswordStatus">Reset password</button><p id="memberPasswordStatus" role="status" aria-live="polite"></p><a href="/member-login" id="memberPasswordSignIn" hidden>Sign in again</a></form></div>`;

export function withPasswordSettings(html) {
  if (html.includes('data-member-password-settings')) return html;
  // Replace only the old disabled security card; retain every other settings control.
  const placeholder = /<div\b[^>]*class="tracker-card"[^>]*>\s*<h3>Security<\/h3>\s*<p>[\s\S]*?<\/p>\s*<button\b[^>]*disabled[^>]*>Account security<\/button>\s*<\/div>/;
  html = placeholder.test(html) ? html.replace(placeholder, passwordCard) : html.replace('</main>', passwordCard + '</main>');
  if (!html.includes('data-member-password-settings')) return html;
  if (!/src="\/turnstile-auth-v1\.js\b/.test(html)) html = html.replace('</body>', '<script defer src="/turnstile-auth-v1.js?v=timeout-20260912"></script></body>');
  return html.replace('</body>', '<script defer src="/assets/member-experience/password-settings.mjs"></script></body>');
}

export const passwordSettingsRuntime = String.raw`(()=>{
  'use strict';
  const form=document.getElementById('memberPasswordReset');
  if(!form)return;
  const button=form.querySelector('button'),status=document.getElementById('memberPasswordStatus'),signIn=document.getElementById('memberPasswordSignIn');
  let pending=false,sent=false;
  form.addEventListener('submit',async event=>{
    event.preventDefault();
    if(pending||sent)return;
    pending=true;button.disabled=true;button.textContent='Requesting reset…';form.setAttribute('aria-busy','true');
    status.textContent='';signIn.hidden=true;
    try{
      const api=window.SST_API;
      if(!api?.getMe||!api?.requestPasswordReset||!window.SSTTurnstile)throw new Error('Password reset could not load. Refresh this page and try again.');
      const account=await api.getMe(),email=account?.user?.email;
      if(typeof email!=='string'||!email.trim()){const error=new Error('Please sign in again before resetting your password.');error.code='session_expired';throw error;}
      // Keep any security check next to this form, including after the button is disabled.
      form.focus({preventScroll:true});
      const result=await api.requestPasswordReset({email});
      if(result?.ok!==true)throw new Error('We could not request a reset link. Please try again.');
      sent=true;
      status.textContent=(result.message||'If that account exists, reset instructions will be sent shortly.')+' Check your inbox and junk folder. Your password stays the same until you use the link.';
      status.dataset.state='success';button.textContent='Reset requested';
    }catch(error){
      const expired=error?.status===401||['session_expired','unauthorised','unauthorized'].includes(error?.code);
      status.textContent=expired?'Please sign in again before resetting your password.':(error?.message||'We could not request a reset link. Please try again.');
      status.dataset.state='error';signIn.hidden=!expired;button.textContent='Reset password';
    }finally{pending=false;button.disabled=sent;form.removeAttribute('aria-busy');}
  });
})();`;
