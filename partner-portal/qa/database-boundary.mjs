// Read the isolated environment marker before any native schema/data handler.
// A mistaken binding to an unmarked production DB fails without a schema write.
export async function qaDatabaseAdmitted(env){
 if(env.SSTRX_ENVIRONMENT!=='synthetic'||env.SSTRX_QA_STACK!=='joined-v31'||!/^[a-f0-9-]{36}$/.test(env.SSTRX_QA_DATABASE_ID||'')||!env.DB)return false;
 try{return !!await env.DB.prepare("SELECT 1 admitted FROM sstrx_qa_environment WHERE environment='joined-v31' AND database_id=? AND synthetic_only=1").bind(env.SSTRX_QA_DATABASE_ID).first()}catch{return false}
}
