if(new URLSearchParams(location.search).get('demo')==='1'){
 const upstream=window.fetch.bind(window),now=()=>new Date().toISOString(),audit=[];
 const partners=[{id:'11111111-1111-4111-8111-111111111111',name:'Example pharmacy partner',service:'pharmacy',model:'shift_sale',status:'discussion',contact_name:'Example contact',contact_email:'pharmacy@example.invalid',owner_name:'SHIFT owner',next_action:'Confirm responsibilities and draft terms',due_date:'2026-10-12',commercial_notes:'Illustrative only. No prices or terms agreed.',version:1,created_at:now(),updated_at:now()},{id:'22222222-2222-4222-8222-222222222222',name:'Example diagnostics partner',service:'diagnostics',model:'referral',status:'exploring',contact_name:'Example contact',contact_email:'tests@example.invalid',owner_name:'SHIFT owner',next_action:'Map the referral and results handover',due_date:'2026-10-14',commercial_notes:'Illustrative referral model. No agreement implied.',version:1,created_at:now(),updated_at:now()}];
 const handovers=[{id:'33333333-3333-4333-8333-333333333333',partner_id:partners[0].id,reference:'EXAMPLE-CASE-104',service:'pharmacy',status:'review',owner_name:'SHIFT owner',next_action:'Review what would be shared',due_date:'2026-10-12',partner_task:'Proposed order handover for review.',disclosure_status:'not_shared',version:1,created_at:now(),updated_at:now()}];
 window.fetch=async(input,init={})=>{
 const url=new URL(typeof input==='string'?input:input.url,location.href),match=url.pathname.match(/^\/v1\/hq\/management\/(partners|partner-handovers)(?:\/([a-f0-9-]{36}))?$/);
 if(url.origin!=='https://api.shiftsometimber.co.uk'||!match)return upstream(input,init);
 const kind=match[1],id=match[2],records=kind==='partners'?partners:handovers,method=init.method||'GET',reply=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
 if(method==='GET')return reply({ok:true,items:records.map(r=>({...r})),partnerAccessEnabled:false,sharingEnabled:false,preview:true});
 if(!['POST','PATCH'].includes(method))return reply({error:'preview_method_blocked'},403);
 let body;try{body=JSON.parse(init.body||'{}')}catch{return reply({error:'invalid_request'},400)}
 if(body.disclosure_status||body.status==='sent')return reply({error:'sharing_not_enabled'},400);
 let record=id?records.find(r=>r.id===id):null;if(id&&!record)return reply({error:'not_found'},404);
 if(record&&body.version!==record.version)return reply({error:'version_conflict'},409);
 if(kind==='partner-handovers'&&record&&body.partner_id!==record.partner_id)return reply({error:'partner_ownership_immutable'},400);
 if(record)Object.assign(record,body,{version:record.version+1,updated_at:now()});
 else{record={id:crypto.randomUUID(),...body,version:1,created_at:now(),updated_at:now(),...(kind==='partner-handovers'?{disclosure_status:'not_shared'}:{})};records.unshift(record);}
 audit.push({id:crypto.randomUUID(),actor_name:'Example owner',action:'preview.partner_record_saved',entity_type:kind,entity_id:record.id,metadata:JSON.stringify({retained:false,shared:false}),created_at:now()});
 return reply({ok:true,item:record,auditRecorded:false,preview:true},id?200:201);
 };
 document.addEventListener('DOMContentLoaded',()=>{const b=document.querySelector('.hq-preview-banner');if(b)b.textContent='INTERACTIVE PREVIEW · Example data · Partner edits reset on refresh · No invitations, member sharing or live API requests';});
}
