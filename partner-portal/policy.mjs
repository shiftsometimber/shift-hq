// This is an additional boundary. The existing clinical service remains authoritative
// for professional checks, organisation approval, assignments, consent and grants.
const uuid='[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}';
export function allowedPath(path, method, kind) {
  if(kind==='clinician'&&['GET','POST'].includes(method)&&/^\/api\/clinical\/platform\/catalogue\/[1-9]\d*$/.test(path))return true;
  if(['clinician','dispensing'].includes(kind)&&['GET','POST'].includes(method)&&/^\/api\/clinical\/platform\/messages(?:\/[a-f0-9-]{36}(?:\/read)?)?$/.test(path))return true;
  if(['clinician','dispensing'].includes(kind)&&method==='POST'&&path==='/api/clinical/platform/responsibility')return true;
  if(['clinician','dispensing'].includes(kind)&&['GET','POST'].includes(method)&&/^\/api\/clinical\/platform\/supply-holds\/[A-Za-z0-9_-]{1,100}$/.test(path))return true;
  if(kind==='clinician'&&((method==='GET'&&/^\/api\/clinical\/platform\/diagnostics(?:\/[a-f0-9-]{36}\/result)?$/.test(path))||(method==='POST'&&/^\/api\/clinical\/platform\/diagnostics(?:\/[a-f0-9-]{36}\/(?:review|acknowledge))?$/.test(path))))return true;
  if(kind==='oversight')return method==='GET'&&/^\/api\/clinical\/platform(?:\/audit)?$/.test(path)||method==='POST'&&path==='/api/clinical/platform/responsibility';
  if(kind==='clinician'&&method==='POST'&&path==='/api/clinical/platform/repeat-clearance')return true;
  if(['clinical_admin','pharmacy_admin'].includes(kind))return method==='GET'&&/^\/api\/clinical\/platform(?:\/(?:identity|audit|memberships))?$/.test(path)||method==='POST'&&/^\/api\/clinical\/platform\/memberships\/\d+\/revoke$/.test(path);
  if(['clinician','dispensing'].includes(kind)&&method==='GET'&&/^\/api\/clinical\/platform(?:\/(?:followups|audit))?$/.test(path))return true;
  if(kind==='clinician'&&method==='POST'&&/^\/api\/clinical\/platform\/followups(?:\/[a-f0-9-]{36}\/complete)?$/.test(path))return true;
  if(['clinician','dispensing'].includes(kind)&&((method==='GET'&&/^\/api\/clinical\/partner-desk(?:\/threads\/[a-f0-9-]{36})?$/.test(path))||(method==='POST'&&/^\/api\/clinical\/partner-desk\/threads(?:\/[a-f0-9-]{36}\/reply)?$/.test(path))))return true;
  if (method==='GET' && path==='/api/clinical/partners/me') return ['clinician','dispensing'].includes(kind);
  if(kind==='clinician'){
    if(method==='GET') return path==='/api/clinical' || new RegExp('^/api/clinical/'+uuid+'(?:/(?:context|audit|evidence/[A-Za-z0-9_-]{1,100}))?$','i').test(path) || new RegExp('^/api/clinical/prescriptions/'+uuid+'$','i').test(path);
    if(method==='POST') return new RegExp('^/api/clinical/'+uuid+'/action$','i').test(path) || new RegExp('^/api/clinical/prescriptions/'+uuid+'/(?:proposal|query|decline|keys/challenge|keys/register|signing-challenge|sign)$','i').test(path);
  }
  if(kind==='dispensing'){
    if(method==='GET') return /^\/api\/clinical\/partners\/fulfilment(?:\/[A-Za-z0-9_-]{1,100})?$/.test(path);
    if(method==='POST') return /^\/api\/clinical\/partners\/fulfilment\/[A-Za-z0-9_-]{1,100}\/action$/.test(path);
  }
  return false;
}
export function validProfessional(identity, staff) {
  return !!(identity?.user?.role==='clinical' && identity.user.mfaEnabled===true && staff?.status==='active' && ['clinician','dispensing'].includes(staff.kind) && staff.orgId && Number(staff.hqUserId)===Number(identity.user.id));
}
export const destination = staff => staff.kind==='clinician'?'/workspace/clinical':'/workspace/dispensing';
