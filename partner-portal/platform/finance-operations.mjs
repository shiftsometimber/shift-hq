// Management of the EXISTING finance exceptions. This cannot move money, amend
// a clinical decision, or turn an operator's note into a processor receipt.
import {fail,text,digest,readObject} from './domain.mjs';
import {ensureRefundSchema,financeGuard} from './refunds.mjs';
const now=()=>new Date().toISOString();
const rows=async query=>(await query.all()).results||[];
const pending=new WeakMap();
const schema=[
 `CREATE TABLE IF NOT EXISTS rx_finance_exception_management(exception_id TEXT PRIMARY KEY REFERENCES rx_finance_exceptions(id),version INTEGER NOT NULL,original_due_at TEXT NOT NULL,cover_owner_id INTEGER,last_management_reference TEXT NOT NULL,resolved_at TEXT,resolution_reference TEXT)`,
 `CREATE TABLE IF NOT EXISTS rx_finance_exception_commands(client_reference TEXT PRIMARY KEY,exception_id TEXT NOT NULL REFERENCES rx_finance_exceptions(id),payload_digest TEXT NOT NULL,result_json TEXT NOT NULL,created_at TEXT NOT NULL)`,
 `CREATE TABLE IF NOT EXISTS rx_finance_exception_history(id INTEGER PRIMARY KEY AUTOINCREMENT,exception_id TEXT NOT NULL REFERENCES rx_finance_exceptions(id),version INTEGER NOT NULL,actor_id INTEGER NOT NULL,action TEXT NOT NULL,source_reference TEXT NOT NULL,previous_digest TEXT NOT NULL,payload_digest TEXT NOT NULL,event_json TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(exception_id,version))`,
 `CREATE TRIGGER IF NOT EXISTS rx_finance_exception_history_no_update BEFORE UPDATE ON rx_finance_exception_history BEGIN SELECT RAISE(ABORT,'immutable_finance_exception_history');END`,
 `CREATE TRIGGER IF NOT EXISTS rx_finance_exception_history_no_delete BEFORE DELETE ON rx_finance_exception_history BEGIN SELECT RAISE(ABORT,'immutable_finance_exception_history');END`,
 `CREATE TRIGGER IF NOT EXISTS rx_finance_exception_command_no_update BEFORE UPDATE ON rx_finance_exception_commands BEGIN SELECT RAISE(ABORT,'immutable_finance_exception_command');END`,
 `CREATE TRIGGER IF NOT EXISTS rx_finance_exception_command_no_delete BEFORE DELETE ON rx_finance_exception_commands BEGIN SELECT RAISE(ABORT,'immutable_finance_exception_command');END`
];
export async function ensureFinanceOperations(DB){
 DB=DB.__sstrxBaseDB||DB;
 if(pending.has(DB))return pending.get(DB);
 const task=(async()=>{
  await ensureRefundSchema(DB);
  for(const sql of schema)await DB.prepare(sql).run();
 })();
 pending.set(DB,task);try{await task}catch(error){pending.delete(DB);throw error}
}
async function guard(env,actor){
 if(!actor.internal)fail(403,'finance_access_required');
 await ensureFinanceOperations(env.DB);
 const g=financeGuard(env,actor);
 g.sql+=" AND EXISTS(SELECT 1 FROM hq_sessions live WHERE live.hq_user_id=? AND live.token_hash=? AND live.revoked_at IS NULL AND julianday(live.expires_at)>julianday('now'))";
 g.args.push(actor.id,actor.sessionHash);
 if(!actor.commercial){
  g.sql+=" AND EXISTS(SELECT 1 FROM rx_finance_authorities WHERE hq_user_id=? AND julianday(expires_at)>julianday('now'))";
  g.args.push(actor.id);
 }
 if(!await env.DB.prepare('SELECT 1 allowed WHERE '+g.sql).bind(...g.args).first())fail(403,'finance_access_required');
 return g;
}
const view=row=>({id:row.id,orderReference:row.order_number,kind:row.kind,state:row.state,
 version:row.version,ownerUserId:row.owner_user_id,coverOwnerUserId:row.cover_owner_id,
 originalDueAt:row.original_due_at||row.due_at,dueAt:row.due_at,
 source:JSON.parse(row.detail_json),createdAt:row.created_at,
 resolvedAt:row.resolved_at,resolutionReference:row.resolution_reference});
const joinedExceptions="SELECT e.*,COALESCE(m.version,1) version,m.original_due_at,m.cover_owner_id,m.last_management_reference,m.resolved_at,m.resolution_reference FROM rx_finance_exceptions e LEFT JOIN rx_finance_exception_management m ON m.exception_id=e.id";
async function financeOwner(env,id){
 if(!Number.isSafeInteger(id))fail(422,'active_finance_owner_required');
 const owner=await env.DB.prepare("SELECT id FROM hq_users u WHERE id=? AND status='active' AND (role IN ('owner','admin') OR (role='operations' AND EXISTS(SELECT 1 FROM rx_finance_authorities f WHERE f.hq_user_id=u.id AND f.expires_at>?)))").bind(id,now()).first();
 if(!owner)fail(422,'active_finance_owner_required');
 return owner.id;
}
async function verifiedResolution(env,row,body){
 const detail=JSON.parse(row.detail_json);
 if(row.kind==='reconciliation_variance'){
  if(body.resolutionKind!=='matched_statement')fail(422,'matching_statement_resolution_required');
  const original=await env.DB.prepare('SELECT * FROM rx_reconciliation_runs WHERE source_reference=? ORDER BY created_at DESC LIMIT 1').bind(detail.sourceReference).first();
  const matched=await env.DB.prepare("SELECT * FROM rx_reconciliation_runs WHERE id=? AND state='matched' AND variance_pence=0").bind(text(body.reconciliationRunId)).first();
  if(!original||!matched||matched.from_at!==original.from_at||matched.to_at!==original.to_at||matched.created_at<original.created_at)fail(409,'verified_matching_period_statement_required');
  return {kind:'matched_statement',reconciliationRunId:matched.id,sourceReference:matched.source_reference,variancePence:0};
 }
 if(['refund_failed','refund_watch'].includes(row.kind)){
  if(body.resolutionKind!=='completed_refund')fail(422,'verified_refund_resolution_required');
  const prior=detail.refundId&&await env.DB.prepare('SELECT * FROM rx_refunds WHERE id=?').bind(detail.refundId).first();
  const completed=await env.DB.prepare("SELECT r.* FROM rx_refunds r WHERE r.id=? AND r.order_number=? AND r.state='completed' AND EXISTS(SELECT 1 FROM rx_refund_receipts x WHERE x.refund_id=r.id AND x.processor_status='succeeded')").bind(text(body.completedRefundId),row.order_number).first();
  if(!prior||!completed||completed.member_id!==prior.member_id||completed.amount_pence!==prior.amount_pence)fail(409,'verified_matching_completed_refund_required');
  return {kind:'completed_refund',refundId:completed.id,processorReference:completed.processor_reference};
 }
 fail(409,'source_specific_resolution_required');
}
async function history(env,id){
 const entries=await rows(env.DB.prepare('SELECT * FROM rx_finance_exception_history WHERE exception_id=? ORDER BY version').bind(id));
 let previous='';
 for(const entry of entries){
  const event=JSON.parse(entry.event_json);
  if(entry.previous_digest!==previous||event.previousDigest!==previous||await digest(event)!==entry.payload_digest)fail(409,'finance_exception_history_integrity_failure');
  previous=entry.payload_digest;
 }
 return entries.map(x=>({version:x.version,actorId:x.actor_id,action:x.action,sourceReference:x.source_reference,
  digest:x.payload_digest,event:JSON.parse(x.event_json),createdAt:x.created_at}));
}
export async function financeOperationsRoute(request,env,actor,parts){
 if(parts[0]!=='finance-exceptions')return null;
 if(env.SSTRX_FUNCTIONAL_V3_ENABLED!=='true')fail(404,'functional_finance_not_open');
 const g=await guard(env,actor);
 if(request.method==='GET'&&parts.length===1){
  const exceptions=await rows(env.DB.prepare(joinedExceptions+" WHERE e.state IN ('open','watching') AND "+g.sql+" ORDER BY e.due_at,e.id LIMIT 200").bind(...g.args));
  const owners=await rows(env.DB.prepare("SELECT id,name FROM hq_users u WHERE status='active' AND (role IN ('owner','admin') OR (role='operations' AND EXISTS(SELECT 1 FROM rx_finance_authorities f WHERE f.hq_user_id=u.id AND f.expires_at>?))) AND "+g.sql+" ORDER BY name").bind(now(),...g.args));
  const matchedStatements=await rows(env.DB.prepare("SELECT id,source_reference sourceReference,from_at fromAt,to_at toAt,created_at createdAt FROM rx_reconciliation_runs WHERE state='matched' AND variance_pence=0 AND "+g.sql+" ORDER BY created_at DESC LIMIT 100").bind(...g.args));
  return {exceptions:exceptions.map(view),owners,matchedStatements,moneyMoved:false};
 }
 const row=await env.DB.prepare(joinedExceptions+' WHERE e.id=? AND '+g.sql).bind(text(parts[1]),...g.args).first();
 if(!row)fail(404,'finance_exception_not_found');
 if(request.method==='GET'&&parts.length===2)return {exception:view(row),history:await history(env,row.id),moneyMoved:false};
 if(request.method!=='POST'||parts.length!==3||!['assign','cover','resolve'].includes(parts[2]))fail(404,'finance_exception_action_not_found');
 const body=await readObject(request),action=parts[2];
 text(body.clientReference);text(body.sourceReference,300);text(body.reason,500);
 const payloadDigest=await digest({actorId:actor.id,exceptionId:row.id,action,body});
 const prior=await env.DB.prepare('SELECT * FROM rx_finance_exception_commands WHERE client_reference=?').bind(body.clientReference).first();
 if(prior){if(prior.payload_digest!==payloadDigest)fail(409,'finance_exception_command_conflict');return {...JSON.parse(prior.result_json),duplicate:true};}
 if(body.version!==row.version)fail(409,'finance_exception_changed');
 if(!['open','watching'].includes(row.state))fail(409,'finance_exception_not_open');
 await history(env,row.id);
 const next={...row,version:row.version+1,original_due_at:row.original_due_at||row.due_at,
             last_management_reference:body.clientReference};
 let resolution=null;
 if(action==='assign'||action==='cover'){
  const owner=await financeOwner(env,body.ownerUserId);
  if(action==='assign')next.owner_user_id=owner;
  else next.cover_owner_id=owner;
  // Cover/assignment preserves the original commitment unless a revised
  // commitment is explicitly approved and remains visible in the history.
  if(body.dueAt!==undefined&&body.dueAt!==row.due_at){
   if(!Number.isFinite(Date.parse(body.dueAt))||new Date(body.dueAt).toISOString()!==body.dueAt||body.dueAt<=now())fail(422,'future_finance_deadline_required');
   text(body.deadlineApprovalReference,300);next.due_at=body.dueAt;
  }
 }else{
  resolution=await verifiedResolution(env,row,body);next.state='closed';
  next.resolved_at=now();next.resolution_reference=body.sourceReference;
 }
 const last=await env.DB.prepare('SELECT payload_digest FROM rx_finance_exception_history WHERE exception_id=? ORDER BY version DESC LIMIT 1').bind(row.id).first();
 let sourceGuard='',sourceArgs=[];
 if(action==='assign'||action==='cover'){
  sourceGuard=" AND EXISTS(SELECT 1 FROM hq_users recipient WHERE recipient.id=? AND recipient.status='active' AND (recipient.role IN ('owner','admin') OR (recipient.role='operations' AND EXISTS(SELECT 1 FROM rx_finance_authorities grant_row WHERE grant_row.hq_user_id=recipient.id AND julianday(grant_row.expires_at)>julianday('now')))))";
  sourceArgs=[body.ownerUserId];
 }else if(resolution.kind==='matched_statement'){
  sourceGuard=" AND EXISTS(SELECT 1 FROM rx_reconciliation_runs proof WHERE proof.id=? AND proof.state='matched' AND proof.variance_pence=0)";
  sourceArgs=[resolution.reconciliationRunId];
 }else{
  sourceGuard=" AND EXISTS(SELECT 1 FROM rx_refunds proof WHERE proof.id=? AND proof.state='completed' AND EXISTS(SELECT 1 FROM rx_refund_receipts receipt WHERE receipt.refund_id=proof.id AND receipt.processor_status='succeeded'))";
  sourceArgs=[resolution.refundId];
 }
 const date=now(),event={exceptionId:row.id,version:next.version,actorId:actor.id,action,
  sourceReference:body.sourceReference,reason:body.reason,
  deadlineApprovalReference:body.deadlineApprovalReference||null,
  before:view(row),after:view(next),resolution,previousDigest:last?.payload_digest||'',createdAt:date};
 const eventDigest=await digest(event),result={exception:view(next),moneyMoved:false,resolutionEvidence:resolution};
 const writes=await env.DB.batch([
  env.DB.prepare(`UPDATE rx_finance_exceptions SET state=?,owner_user_id=?,due_at=? WHERE id=? AND COALESCE((SELECT version FROM rx_finance_exception_management WHERE exception_id=?),1)=? AND state=? AND owner_user_id=? AND due_at=? AND ${g.sql}${sourceGuard}`).bind(next.state,next.owner_user_id,next.due_at,row.id,row.id,row.version,row.state,row.owner_user_id,row.due_at,...g.args,...sourceArgs),
  env.DB.prepare('INSERT INTO rx_finance_exception_management SELECT ?,?,?,?,?,?,? WHERE changes()=1 ON CONFLICT(exception_id) DO UPDATE SET version=excluded.version,original_due_at=excluded.original_due_at,cover_owner_id=excluded.cover_owner_id,last_management_reference=excluded.last_management_reference,resolved_at=excluded.resolved_at,resolution_reference=excluded.resolution_reference').bind(row.id,next.version,next.original_due_at,next.cover_owner_id,next.last_management_reference,next.resolved_at,next.resolution_reference),
  env.DB.prepare('INSERT INTO rx_finance_exception_history(exception_id,version,actor_id,action,source_reference,previous_digest,payload_digest,event_json,created_at) SELECT ?,?,?,?,?,?,?,?,? WHERE changes()=1').bind(row.id,next.version,actor.id,action,body.sourceReference,last?.payload_digest||'',eventDigest,JSON.stringify(event),date),
  env.DB.prepare('INSERT INTO rx_finance_exception_commands SELECT ?,?,?,?,? WHERE changes()=1').bind(body.clientReference,row.id,payloadDigest,JSON.stringify(result),date)
 ]);
 if(writes[0].meta.changes!==1){
  const replay=await env.DB.prepare('SELECT * FROM rx_finance_exception_commands WHERE client_reference=?').bind(body.clientReference).first();
  if(replay?.payload_digest===payloadDigest)return {...JSON.parse(replay.result_json),duplicate:true};
  fail(409,'finance_exception_or_access_changed');
 }
 return result;
}
