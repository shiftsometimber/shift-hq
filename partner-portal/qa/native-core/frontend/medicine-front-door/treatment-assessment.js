const API='https://api.shiftsometimber.co.uk';
const params=new URLSearchParams(location.search);
const variantId=Number(params.get('variant'));
const returnTo=String(params.get('returnTo')||'/treatment-order');
const form=document.querySelector('#assessment');
const status=document.querySelector('#status');
const previous=document.querySelector('#previousTreatment');
const previousDetails=document.querySelector('#previousDetails');
document.querySelector('#variantId').value=Number.isInteger(variantId)&&variantId>0?String(variantId):'';
previous.onchange=()=>{const yes=previous.value==='yes';previousDetails.hidden=!yes;for(const input of previousDetails.querySelectorAll('input')){input.required=yes;input.disabled=!yes}};
previous.onchange();
let accountReference=null,intakeReference=null,submissionId=null,dirty=false,busy=false,stopped=false,booted=false,contactReadSequence=0,pageEpoch=0;
const node=id=>document.getElementById(id);
function finish(result){
  const epoch=pageEpoch;
  sessionStorage.setItem(`sst-medicine-verification:${variantId}`,JSON.stringify({token:result.verificationToken,expiresAt:result.expiresAt,accountReference}));
  let target;
  try{target=new URL(returnTo,location.origin);if(target.origin!==location.origin)throw Error('external return')}catch{target=new URL('/treatment-order',location.origin)}
  target.searchParams.set('variant',String(variantId));
  target.searchParams.set('verified','1');
  dirty=false;
  status.textContent='Verification accepted. Returning to payment; the prescribing decision is still separate…';
  setTimeout(()=>{if(!stopped&&epoch===pageEpoch)location.assign(target.pathname+target.search+target.hash)},700);
}
function signIn(){
  stopped=true;++pageEpoch;++contactReadSequence;dirty=false;form.reset();form.hidden=true;node('assessmentActions').hidden=true;
  sessionStorage.removeItem(`sst-medicine-verification:${variantId}`);
  const account=node('accountStatus');account.textContent='Sign in to your My Timber account to continue the same treatment. ';
  const link=document.createElement('a');link.href='/member-login?returnTo='+encodeURIComponent(location.pathname+location.search);link.textContent='Sign in or create an account';account.append(link);
  status.textContent='Your session has ended. Submitted information remains with the same assessment; unsent answers have been cleared from this page.';
}
async function call(path,options={}){
  const epoch=pageEpoch;
  const response=await fetch(API+path,{credentials:'include',cache:'no-store',signal:AbortSignal.timeout(20000),...options});
  const result=await response.json();
  if(stopped||epoch!==pageEpoch)throw Object.assign(new Error('This assessment view has changed.'),{staleView:true});
  if(response.status===401){signIn();throw Error('Sign in again to continue this assessment.');}
  return {response,result};
}
function showResult(result){
  if(result.intakeReference)intakeReference=result.intakeReference;
  if(result.verified&&result.verificationToken){finish(result);return true;}
  if(!intakeReference)return false;
  form.hidden=true;dirty=false;node('assessmentActions').hidden=false;
  node('resumeAssessment').hidden=!(result.canResume&&result.status==='more_information_required');
  const messages={
    submitted:'Your details and evidence are with the pharmacy for verification. No payment has been taken. You can close this page and return to the same assessment.',
    sending:'This assessment is already being sent. Check it again; no duplicate submission has been sent.',
    delivery_unconfirmed:'The pharmacy receipt has not been confirmed. No payment has been taken. Check this assessment again; do not start another submission.',
    more_information_required:result.canResume?'The pharmacy needs more information. Open its secure questions to respond to this same assessment. No new payment is needed.':'The pharmacy needs more information, but its secure questions route is not available yet. Your existing assessment is unchanged. Do not submit a new one.',
    declined:'The pharmacy has not accepted this verification. No payment has been taken. A clinician must advise on the appropriate next step.',
    payment_started:'Payment has already been started for this assessment. Check My Timber for the current order; verification cannot create another payment.',
    verified:'The pharmacy must confirm its patient reference before payment can open.',
  };
  status.textContent=messages[result.status]||'Check your existing assessment for the next step.';
  return ['more_information_required','declined','payment_started','verified'].includes(result.status);
}
async function checkAssessment(){
  const query=intakeReference?'reference='+encodeURIComponent(intakeReference):'variant='+encodeURIComponent(variantId);
  const {response,result}=await call('/v1/commerce/medicine-clinical-intake-status?'+query);
  if(response.status===404)return null;
  if(!response.ok&&!result.intakeReference)throw Error(result.message||'This assessment could not be checked.');
  showResult(result);return result;
}
async function waitFor(reference){
  const epoch=pageEpoch;
  intakeReference=reference;
  for(let attempt=0;attempt<40&&!stopped&&epoch===pageEpoch;attempt++){
    await new Promise(resolve=>setTimeout(resolve,3000));
    if(stopped||epoch!==pageEpoch)return;
    const result=await checkAssessment();
    if(!result||result.verified||['more_information_required','declined','payment_started','verified','delivery_unconfirmed'].includes(result.status))return;
  }
  if(!stopped&&epoch===pageEpoch)status.textContent='Verification is still being reviewed. No payment has been taken. You can close this page and reopen the same assessment later.';
}
form.onsubmit=async event=>{
  event.preventDefault();if(busy||stopped)return;
  const epoch=pageEpoch;
  const button=form.querySelector('button[type="submit"]');
  if(!variantId){status.textContent='Choose a treatment before starting verification.';return;}
  busy=true;button.disabled=true;status.textContent='Sending securely to the pharmacy partner…';
  try{
    const data=new FormData(form);data.set('submissionId',submissionId);
    const {response,result}=await call('/v1/commerce/medicine-clinical-intake',{method:'POST',body:data});
    if(result.intakeReference){showResult(result);if(!response.ok)return;}
    if(!response.ok){
      if(result.field)form.elements.namedItem(result.field)?.focus();
      throw Error(result.message||'The assessment could not be submitted. Your answers remain on this page.');
    }
    if(result.verified&&result.verificationToken)return;
    await waitFor(result.intakeReference);
  }catch(error){if(!error.staleView&&epoch===pageEpoch)status.textContent=error.name==='TimeoutError'?'The connection was interrupted. Keep this page open and retry the same submission; its reference prevents another send.':error.message;}
  finally{if(epoch===pageEpoch){busy=false;button.disabled=stopped;}}
};
async function initialise(){
  const epoch=++pageEpoch;++contactReadSequence;stopped=false;busy=false;form.hidden=true;
  try{
    const {response,result}=await call('/v1/commerce/medicine-clinical-context');
    if(!response.ok)throw Error('Your account could not be checked. Retry this page.');
    if(accountReference&&accountReference!==result.accountReference){form.reset();dirty=false;intakeReference=null;}
    accountReference=result.accountReference;stopped=false;
    node('useContactDetails').disabled=false;node('savedContactStatus').textContent='';
    const key=`sst-intake-submission:${accountReference}:${variantId}`;
    submissionId=sessionStorage.getItem(key)||crypto.randomUUID();sessionStorage.setItem(key,submissionId);
    node('accountStatus').textContent=result.emailVerified?'Signed in to My Timber. Check your saved contact details before submitting.':'Your account email must be verified before submission. No email has been requested by this page.';
    node('patientEmail').value=result.patientEmail||'';
    for(const name of ['patientFirstName','patientLastName'])if(!form.elements[name].value)form.elements[name].value=result[name]||'';
    if(params.has('order')){
      node('accountStatus').textContent='Continue the existing order through its secure pharmacy route.';
      node('assessmentActions').hidden=false;node('resumeAssessment').hidden=false;form.hidden=true;return;
    }
    const existing=await checkAssessment();
    if(existing)return;
    const [catalogueResponse]=await Promise.allSettled([
      fetch(API+'/v1/catalogue/medicines',{credentials:'include',cache:'no-store',signal:AbortSignal.timeout(10000)}),
    ]);
    if(stopped||epoch!==pageEpoch)return;
    let selected;
    if(catalogueResponse.status==='fulfilled'&&catalogueResponse.value.ok){
      const catalogue=await catalogueResponse.value.json();
      for(const product of catalogue.products||[]){const variant=product.variants?.find(v=>Number(v.id)===variantId);if(variant)selected={...variant,medicineName:product.name};}
    }
    node('selectionStatus').textContent=selected?selected.medicineName+' · '+selected.strengthLabel:'Choose an available treatment and dose before starting.';
    if(!selected||selected.status!=='available'||!result.assessmentAvailable){status.textContent='Assessment is not open for this selection. No information has been sent and no payment has been taken.';form.hidden=true;return;}
    form.hidden=false;form.querySelector('button[type="submit"]').disabled=!result.emailVerified;previous.onchange();
  }catch(error){if(!stopped&&!error.staleView&&epoch===pageEpoch)status.textContent=error.message||'Your assessment could not load. Retry this page; nothing has been sent.';}
}
async function reuseContactDetails(){
  if(stopped||busy||!accountReference)return;
  const sequence=++contactReadSequence,account=accountReference,button=node('useContactDetails'),message=node('savedContactStatus');
  const map={firstName:'patientFirstName',lastName:'patientLastName',phone:'patientPhone',address1:'patientAddress1',address2:'patientAddress2',town:'patientTown',postcode:'patientPostcode',dateOfBirth:'dateOfBirth'};
  const before=Object.fromEntries(Object.values(map).map(key=>[key,form.elements[key].value]));
  button.disabled=true;message.textContent='Loading your saved contact details…';
  try{
    const response=await fetch('/v1/member/details',{credentials:'include',cache:'no-store',signal:AbortSignal.timeout(10000)});
    if(stopped||sequence!==contactReadSequence||account!==accountReference)return;
    if(response.status===401){signIn();return;}
    if(!response.ok)throw Error('Your saved contact details could not load. Your entered details are unchanged.');
    const profile=(await response.json()).details||{};
    if(stopped||sequence!==contactReadSequence||account!==accountReference)return;
    for(const [source,target]of Object.entries(map))if(typeof profile[source]==='string'&&form.elements[target].value===before[target])form.elements[target].value=profile[source];
    dirty=true;message.textContent='Saved contact details filled. Check they are current. Use the separate GP details control below to confirm your registered practice; consent still needs your choice.';
  }catch(error){if(!stopped&&sequence===contactReadSequence)message.textContent=error.name==='TimeoutError'?'Saved details timed out. Your entered details are unchanged; you can fill them manually.':error.message;}
  finally{if(sequence===contactReadSequence)button.disabled=stopped;}
}
if(typeof window!=='undefined'){
  form.hidden=true;
  form.addEventListener('input',()=>{dirty=true;});
  window.addEventListener('beforeunload',event=>{if(dirty&&!intakeReference){event.preventDefault();event.returnValue='';}});
  window.addEventListener('pagehide',()=>{stopped=true;++pageEpoch;++contactReadSequence;form.reset();form.hidden=true;});
  window.addEventListener('pageshow',()=>{if(booted)initialise();else booted=true;});
  node('checkAssessment').onclick=async()=>{try{await checkAssessment();}catch(error){if(!error.staleView)status.textContent=error.message;}};
  node('useContactDetails').onclick=reuseContactDetails;
  node('resumeAssessment').onclick=async()=>{
    const epoch=pageEpoch,button=node('resumeAssessment');button.disabled=true;
    try{
      const {response,result}=await call('/v1/commerce/medicine-clinical-intake-resume',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(params.has('order')?{orderNumber:params.get('order')}:{intakeReference})});
      if(!response.ok)throw Error(result.message||'The secure pharmacy questions could not open.');
      dirty=false;location.assign(result.resumeUrl);
    }catch(error){if(!error.staleView&&epoch===pageEpoch)status.textContent=error.message;}finally{if(epoch===pageEpoch)button.disabled=false;}
  };
  initialise();
}

