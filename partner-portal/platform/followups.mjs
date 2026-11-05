import {ensurePlatformSchema} from './schema.mjs';
export function londonReviewDeadline(day){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(day||''))return null;const d=new Date(day+'T00:00:00Z');if(!Number.isFinite(d.getTime())||d.toISOString().slice(0,10)!==day)return null;d.setUTCDate(d.getUTCDate()+1);const nominal=d.getTime(),p=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(d).map(x=>[x.type,x.value]));const asUtc=Date.UTC(+p.year,+p.month-1,+p.day,+p.hour,+p.minute,+p.second);return new Date(nominal-(asUtc-nominal)-1).toISOString();
}
export async function captureClinicalFollowup(env,orderNumber){
 if(env.SSTRX_PLATFORM_ENABLED!=='true')return;await ensurePlatformSchema(env.DB);
 const source=await env.DB.prepare("SELECT e.id,e.record_id,e.private_json,e.created_at,p.org_id FROM clinical_case_events e JOIN clinical_member_records r ON r.id=e.record_id JOIN partner_staff p ON p.hq_user_id=e.actor_user_id WHERE r.order_number=? AND e.kind='clinical_decision' AND json_extract(e.public_json,'$.outcome')='proceed' ORDER BY e.version DESC LIMIT 1").bind(orderNumber).first();
 if(!source)return;const handover=JSON.parse(source.private_json).handover,deadline=londonReviewDeadline(handover?.followUpDate);if(!deadline||!handover?.monitoringPlan)return;
 const detail={source:'clinical_handover',sourceEvent:source.id,ownerText:handover.followUpOwner,instructions:handover.monitoringPlan};
 await env.DB.batch([
  env.DB.prepare("INSERT OR IGNORE INTO rx_followups VALUES(?,?,?,0,'review',?,'needs_owner',1,?,?,?)").bind(source.id,source.record_id,source.org_id,deadline,JSON.stringify(detail),source.created_at,source.created_at),
  env.DB.prepare("UPDATE rx_followups SET status='superseded',version=version+1 WHERE record_id=? AND id<>? AND status IN ('needs_owner','open') AND json_extract(detail_json,'$.source')='clinical_handover'").bind(source.record_id,source.id)
 ]);
 // Free-text ownership is preserved; the software never guesses a responsible professional.
}
