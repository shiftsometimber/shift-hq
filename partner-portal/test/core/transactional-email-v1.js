import {recordAuthDelivery} from './auth-delivery-v1.js';

export const SHIFT_MAILBOXES=Object.freeze({
  hello:'hello@shiftsometimber.co.uk',
  matt:'matt@shiftsometimber.co.uk',
  support:'support@shiftsometimber.co.uk',
  orders:'orders@shiftsometimber.co.uk',
  clinical:'clinical@shiftsometimber.co.uk',
  complaints:'complaints@shiftsometimber.co.uk',
  privacy:'privacy@shiftsometimber.co.uk',
  partners:'partners@shiftsometimber.co.uk',
  press:'press@shiftsometimber.co.uk',
  finance:'finance@shiftsometimber.co.uk',
  accounts:'accounts@shiftsometimber.co.uk',
  feedback:'feedback@shiftsometimber.co.uk',
  hq:'hq@shiftsometimber.co.uk',
  it:'it@shiftsometimber.co.uk'
});

const DEFAULT_FROM=SHIFT_MAILBOXES.hello;
const ROUTING=Object.freeze({
  order_confirmation:[SHIFT_MAILBOXES.orders,SHIFT_MAILBOXES.hello],
  clinical_status:[SHIFT_MAILBOXES.clinical,SHIFT_MAILBOXES.hello],
  interest_notify:[SHIFT_MAILBOXES.support,SHIFT_MAILBOXES.hello],
  support:[SHIFT_MAILBOXES.support],
  orders:[SHIFT_MAILBOXES.orders],
  clinical:[SHIFT_MAILBOXES.clinical],
  complaint:[SHIFT_MAILBOXES.complaints],
  privacy:[SHIFT_MAILBOXES.privacy],
  partner:[SHIFT_MAILBOXES.partners],
  press:[SHIFT_MAILBOXES.press],
  finance:[SHIFT_MAILBOXES.finance],
  accounts:[SHIFT_MAILBOXES.accounts],
  feedback:[SHIFT_MAILBOXES.feedback],
  hq:[SHIFT_MAILBOXES.hq],
  it:[SHIFT_MAILBOXES.it]
});

function internalRecipients(eventType,includeMatt=false){
  const recipients=[...(ROUTING[eventType]||[SHIFT_MAILBOXES.hello])];
  if(includeMatt) recipients.push(SHIFT_MAILBOXES.matt);
  return recipients;
}

// Delivery logging must never turn an accepted email into a failed send or
// encourage a duplicate resend. "sent" retains its historical provider meaning;
// an inbox receipt is separate evidence, never inferred here.
async function auditDelivery(env,detail){
  try{return (await recordAuthDelivery(env.DB,detail)).recorded===true}
  catch{console.error('transactional_email_audit_unavailable',detail.eventType,detail.status);return false}
}
const escapeHtml=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export async function sendTransactionalEmail(env,{to,subject,text,html,eventType,userId=null,internalNotify=false,includeMatt=false,eventReference=null,templateVersion=null}){
  const isSupport=eventType==='support'||eventType==='interest_notify';
  const sender=isSupport?SHIFT_MAILBOXES.support:String(env.TRANSACTIONAL_EMAIL_FROM||DEFAULT_FROM);
  const recipients=[to,...(internalNotify?internalRecipients(eventType,includeMatt):[])].filter(Boolean);
  const unique=[...new Set(recipients.map(x=>String(x).trim().toLowerCase()))];
  const results=[];
  for(const email of unique){
    const eventLink=eventReference?{eventReference,templateVersion,recipientRole:email===String(to||'').trim().toLowerCase()?'member':'operator'}:{};
    if(!env.EMAIL){
      const auditRecorded=await auditDelivery(env,{userId,email,eventType,status:'binding_missing',...eventLink});
      results.push({email,status:'binding_missing',auditRecorded,receiptVerified:false});
      continue;
    }
    try{
      const result=await env.EMAIL.send({
        from:{email:sender,name:isSupport?'Shift Some Timber Support':'Shift Some Timber'},
        to:email,replyTo:(ROUTING[eventType]||[DEFAULT_FROM])[0],
        subject:String(subject||'SHIFT update').replace(/[\r\n]+/g,' ').slice(0,180),
        text:String(text||''),html:String(html||'')
      });
      const providerId=result?.id||result?.messageId||null;
      const auditRecorded=await auditDelivery(env,{userId,email,eventType,status:'sent',providerId,...eventLink});
      results.push({email,status:'sent',providerId,auditRecorded,receiptVerified:false});
    }catch(e){
      const errorCode=String(e?.code||e?.name||'delivery_error').replace(/[^a-zA-Z0-9_.:-]/g,'_').slice(0,120);
      const auditRecorded=await auditDelivery(env,{userId,email,eventType,status:'failed',errorCode,...eventLink});
      console.error('transactional_email_failed',eventType,errorCode);
      results.push({email,status:'failed',errorCode,auditRecorded,receiptVerified:false});
    }
  }
  return results;
}

export const medicineEmailTemplates={
  orderConfirmation:o=>({eventType:'order_confirmation',subject:`SHIFT order ${o.orderNumber||''} received`,text:`Your SHIFT order has been received and is moving to clinical checks.`,html:`<h1>Order received</h1><p>Your order has been received and is moving to clinical checks.</p>`}),
  clinicalStatus:o=>({eventType:'clinical_status',subject:`SHIFT clinical status update`,text:`Your clinical status is now: ${o.status||'updated'}.`,html:`<h1>Clinical status update</h1><p>Your status is now: <strong>${escapeHtml(o.status||'updated')}</strong>.</p>`}),
  interestNotify:o=>({eventType:'interest_notify',subject:`SHIFT interest registered`,text:`We have registered your interest and will update you when this route is genuinely available.`,html:`<h1>Interest registered</h1><p>We’ll update you when this route is genuinely available.</p>`})
};
