// A projection of existing records, never a second profile or synchronised copy.
export function groupCareRecords(records){
 const cards=new Map();
 for(const r of records){
  if(!cards.has(r.memberId))cards.set(r.memberId,{memberId:r.memberId,records:[]});
  cards.get(r.memberId).records.push(r);
 }
 return [...cards.values()];
}
export async function memberCareCard(env,actor){
 const {results:records=[]}=await env.DB.prepare(`SELECT r.id recordId,r.user_id memberId,r.order_number orderNumber,r.status assessmentStatus,r.updated_at updatedAt,cs.status clinicalStatus,json_extract(rx.state_json,'$.status') prescriptionStatus,m.medicine_name requestedMedicine,m.status paymentStatus,json_extract(f.state_json,'$.status') pharmacyStatus,f.updated_at pharmacyUpdatedAt
 FROM clinical_member_records r LEFT JOIN medicine_orders m ON m.order_number=r.order_number AND m.user_id=r.user_id LEFT JOIN clinical_case_state cs ON cs.record_id=r.id LEFT JOIN clinical_prescription_requests rx ON rx.record_id=r.id LEFT JOIN partner_fulfilment f ON f.order_number=m.order_number
 WHERE r.user_id=? ORDER BY r.updated_at DESC LIMIT 101`).bind(actor.id).all();
 return {memberId:actor.id,account:{firstName:actor.first_name||'',lastName:actor.last_name||'',email:actor.email},records:groupCareRecords(records.slice(0,100))[0]?.records||[],hasMore:records.length>100,observedAt:new Date().toISOString(),source:'existing_SHIFT_identity_clinical_prescription_and_order_records',clinicalServiceOpen:env.CLINICAL_REVIEW_READY==='true',newClinicalApproval:false};
}
function mountMemberCareCard(){
 const host=document.getElementById('member-care-card');if(!host)return;
 const node=(t,s)=>{const e=document.createElement(t);if(s!==undefined)e.textContent=s;return e;};let active=true;
 window.addEventListener('pagehide',()=>{active=false;host.replaceChildren();},{once:true});
 const label=s=>s?String(s).replaceAll('_',' '):'Not yet recorded';
 fetch('/v1/member/care-card',{credentials:'same-origin',cache:'no-store'}).then(async r=>{if(!r.ok)throw Error(r.status===401?'Sign in again to open your care record.':'Your care record is unavailable. Please try again.');return r.json();}).then(d=>{
  if(!active)return;host.replaceChildren(node('h2','Your member care record'));
  host.append(node('p',[d.account.firstName,d.account.lastName].filter(Boolean).join(' ')),node('p',d.account.email),node('p','Member reference: SHIFT-'+d.memberId));
  host.append(node('p','Your website and app use this same account and care history.'));
  if(!d.records.length)host.append(node('p','No treatment records are linked to your account yet.'));
  for(const r of d.records){const card=node('article');card.className='fulfilment-card';card.append(node('h3',r.orderNumber||'Treatment record'),node('p','Record reference: '+r.recordId));
   if(r.requestedMedicine)card.append(node('p','Requested treatment: '+r.requestedMedicine));
   const list=node('dl');for(const [k,v]of [['Assessment',r.assessmentStatus],['Clinical review',r.clinicalStatus],['Prescription',r.prescriptionStatus],['Order payment',r.paymentStatus],['Pharmacy progress',r.pharmacyStatus]])list.append(node('dt',k),node('dd',label(v)));card.append(list,node('p','Record updated: '+new Date(r.updatedAt).toLocaleString('en-GB',{timeZone:'Europe/London'})));
   if(d.clinicalServiceOpen){const a=node('a','Open treatment details');a.href='/member/treatment-records?record='+encodeURIComponent(r.recordId);card.append(a);}host.append(card);
  }
  if(d.hasMore)host.append(node('p','Showing the latest 100 treatment records. Contact SHIFT support for older records.'));
  host.append(node('p','Checked '+new Date(d.observedAt).toLocaleString('en-GB',{timeZone:'Europe/London'})));
 }).catch(e=>{if(active)host.replaceChildren(node('p',e.message));});
}
export const MEMBER_CARE_CARD_CLIENT='('+mountMemberCareCard.toString()+')();';
