// Private provider-statement double. Source amounts come from the provider
// double's retained transactions, never an application ledger or supplied net.
import {qaDatabaseAdmitted} from './database-boundary.mjs';
import {digest} from '../platform/domain.mjs';
const deny=(error,status=409)=>Response.json({error,simulation:true},{status});
const fictional=value=>typeof value==='string'&&/@example\.(?:test|invalid)$/.test(value);
async function admitted(env){
 if(env.SSTRX_QA_STATEMENTS_ENABLED!=='true'||env.SSTRX_QA_REFUNDS_ENABLED!=='true'||env.STRIPE_MODE!=='test'||env.STRIPE_SECRET_KEY||!await qaDatabaseAdmitted(env))throw Error('isolated_qa_statement_transport_required');
}
async function present(DB,name){return !!await DB.prepare("SELECT 1 ok FROM sqlite_master WHERE type='table' AND name=?").bind(name).first();}
async function schema(DB){
 await DB.prepare('CREATE TABLE IF NOT EXISTS qa_simulated_statements(reference TEXT PRIMARY KEY,from_at TEXT NOT NULL,to_at TEXT NOT NULL,statement_json TEXT NOT NULL,payload_digest TEXT NOT NULL,created_at TEXT NOT NULL)').run();
 for(const action of ['UPDATE','DELETE'])await DB.prepare("CREATE TRIGGER IF NOT EXISTS qa_simulated_statements_no_"+action.toLowerCase()+" BEFORE "+action+" ON qa_simulated_statements BEGIN SELECT RAISE(ABORT,'immutable_qa_statement'); END").run();
}
export function qaStatementReference(fromAt,toAt,nonce=crypto.randomUUID()){return 'TEST-QA-STMT-'+nonce+'-'+Date.parse(fromAt)+'-'+Date.parse(toAt);}
export function qaStatementTransport(env){return {async fetch(request){
 await admitted(env);
 const url=new URL(request.url),path=url.pathname.match(/^\/statement\/([^/]+)$/);
 if(request.method!=='GET'||url.origin!=='https://processor.invalid'||url.search||url.hash||!path)return deny('qa_statement_route_required',403);
 let reference;try{reference=decodeURIComponent(path[1])}catch{return deny('qa_statement_reference_required',422)}
 const parts=reference.match(/^TEST-QA-STMT-([a-f0-9-]{36})-(\d{13})-(\d{13})$/);if(!parts)return deny('qa_statement_reference_required',422);
 const start=Number(parts[2]),end=Number(parts[3]);
 if(start>=end||end>Date.now()||end-start>31*86400000||start<Date.UTC(2020,0,1))return deny('closed_qa_statement_period_required',422);
 const fromAt=new Date(start).toISOString(),toAt=new Date(end).toISOString();
 await schema(env.DB);
 const saved=await env.DB.prepare('SELECT * FROM qa_simulated_statements WHERE reference=?').bind(reference).first();
 if(saved){
  let statement;try{statement=JSON.parse(saved.statement_json)}catch{return deny('qa_statement_receipt_corrupt')}
  if(saved.from_at!==fromAt||saved.to_at!==toAt||await digest(statement)!==saved.payload_digest)return deny('qa_statement_receipt_corrupt');
  return Response.json(statement,{headers:{'Cache-Control':'no-store, private'}});
 }
 const receipts=[];let captures=0,refunds=0;
 if(await present(env.DB,'qa_simulated_checkouts')){
  const pending=await env.DB.prepare("SELECT COUNT(*) n FROM qa_simulated_checkouts WHERE outcome='processing' AND event_created>=? AND event_created<?").bind(start/1000,end/1000).first();
  if(pending.n)return deny('qa_provider_period_has_unresolved_payment');
  const rows=(await env.DB.prepare("SELECT q.*,u.email FROM qa_simulated_checkouts q LEFT JOIN users u ON u.id=q.member_id WHERE q.outcome='paid' AND q.event_created>=? AND q.event_created<? ORDER BY q.id LIMIT 1001").bind(start/1000,end/1000).all()).results||[];
  if(rows.length>1000)return deny('qa_statement_source_limit',503);
  for(const row of rows){
   let session;try{session=JSON.parse(row.session_json)}catch{return deny('qa_provider_capture_corrupt')}
   if(!fictional(row.email)||!/^cs_test_QA_[a-f0-9]{32}$/.test(row.id)||session.id!==row.id||session.object!=='checkout.session'||session.livemode!==false||session.simulation!==true||session.currency!=='gbp'||session.client_reference_id!==row.order_number||session.metadata?.order_number!==row.order_number||session.metadata?.order_type!=='medicine'||Number(session.metadata?.user_id)!==row.member_id||!Number.isSafeInteger(session.amount_total)||session.amount_total<=0||row.event_id!=='evt_test_QA_'+row.id||row.event_type!=='checkout.session.completed'||!Number.isSafeInteger(row.event_created))return deny('qa_provider_capture_corrupt');
   receipts.push({id:row.event_id,kind:'capture',amountPence:session.amount_total,occurredAt:new Date(row.event_created*1000).toISOString()});captures++;
  }
 }
 if(await present(env.DB,'qa_simulated_refunds')){
  const rows=(await env.DB.prepare('SELECT * FROM qa_simulated_refunds WHERE created_at>=? AND created_at<? ORDER BY refund_id LIMIT 1001').bind(fromAt,toAt).all()).results||[];
  if(rows.length>1000)return deny('qa_statement_source_limit',503);
  for(const row of rows){
   let response;try{response=JSON.parse(row.response_json)}catch{return deny('qa_provider_refund_corrupt')}
   if(!/^re_test_QA_[a-f0-9]{32}$/.test(response.id||'')||response.object!=='refund'||response.status!=='succeeded'||response.livemode!==false||response.simulation!==true||response.currency!=='gbp'||!/^pi_test_QA_[a-f0-9]{32}$/.test(response.payment_intent||'')||!Number.isSafeInteger(response.amount)||response.amount<=0||!Number.isFinite(Date.parse(row.created_at)))return deny('qa_provider_refund_corrupt');
   receipts.push({id:response.id,kind:'refund',amountPence:-response.amount,occurredAt:row.created_at});refunds++;
  }
 }
 receipts.sort((a,b)=>a.id.localeCompare(b.id));
 const totalPence=receipts.reduce((n,r)=>n+r.amountPence,0);if(!Number.isSafeInteger(totalPence))return deny('qa_statement_total_invalid');
 const statement={reference,fromAt,toAt,currency:'GBP',netReceivedPence:totalPence,simulation:true,source:'durable_qa_processor_receipts',coverage:'medicine_original_payments_and_refunds',captureCount:captures,refundCount:refunds,receiptDigest:await digest(receipts),generatedAt:new Date().toISOString(),bankBalanceRepresented:false};
 await env.DB.prepare('INSERT OR IGNORE INTO qa_simulated_statements VALUES(?,?,?,?,?,?)').bind(reference,fromAt,toAt,JSON.stringify(statement),await digest(statement),statement.generatedAt).run();
 const retained=await env.DB.prepare('SELECT statement_json,payload_digest FROM qa_simulated_statements WHERE reference=?').bind(reference).first(),value=JSON.parse(retained.statement_json);
 if(await digest(value)!==retained.payload_digest)return deny('qa_statement_receipt_corrupt');
 return Response.json(value,{headers:{'Cache-Control':'no-store, private'}});
}};}
export async function qaStatementEnvironment(env){
 if(env.SSTRX_QA_STATEMENTS_ENABLED!=='true')return env;
 await admitted(env);if(env.STATEMENT_TEST_TRANSPORT)throw Error('qa_statement_binding_already_supplied');
 return {...env,STATEMENT_TEST_TRANSPORT:qaStatementTransport(env)};
}
