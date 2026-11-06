// Synthetic commissioning fixtures only, never imported by deployed services.
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import clinical from '../service/clinical-service.mjs';
import {ensurePlatformSchema} from '../platform/schema.mjs';
import {currentCoreRoot} from './core-runtime.mjs';
export function prepareTestProfessionals(f){
 const {s}=f,{sql}=s,stamp=new Date().toISOString(),future=new Date(Date.now()+86400000).toISOString(),past=new Date(Date.now()-86400000).toISOString();
 for(const [id,kind]of [['test-clinical-org','clinical'],['test-pharmacy','pharmacy']]){const org={id,kind,name:'TEST '+id,status:'approved',version:1,expiresAt:future,premises:'FICTIONAL ADDRESS — NO REAL PRACTICE',registration:'SYNTHETIC-NOT-A-REAL-REGISTRATION'};sql.prepare('INSERT OR IGNORE INTO partner_organisations VALUES(?,1,?,?)').run(id,JSON.stringify(org),stamp);}
 for(const [actor,kind,org]of [['clinician','clinician','test-clinical-org'],[f.dispenserActor||'dispenser','dispensing',f.pharmacyOrgId||'test-pharmacy']]){
  const id=s.actors[actor].user.id,profile={id:'test-professional-'+id,hqUserId:id,username:actor==='clinician'?'CLNTEST':actor==='dispenser'?'DSPTEST':'DSPSWITCH',kind,orgId:org,status:'active',version:1,credentialVersion:1,details:{name:'TEST '+actor,email:s.secrets.get(actor).email,profession:kind==='clinician'?'GP':'Pharmacist',regulator:kind==='clinician'?'GMC':'GPhC',registrationNumber:'SYNTHETIC-'+id,prescribingEntitlement:'Fictional acceptance only'},evidence:[],checks:['identity','registration','indemnity','agreements','competence'].map(kind=>({kind,credentialVersion:1,outcome:'verified',expiresAt:future})),grants:[{credentialVersion:1,area:'weight_management',startsAt:past,expiresAt:future,medicines:[],actions:kind==='clinician'?['review','query','clinical_decision','issue_prescription']:['view_fulfilment','query','supply_decision','prepare','dispatch','record_delivery','record_exception','cancel_supply']}],passwordSetAt:stamp};
  sql.prepare('INSERT OR IGNORE INTO partner_staff VALUES(?,?,?,?,?,1,?,?)').run(profile.id,id,profile.username,kind,org,JSON.stringify(profile),stamp);
 }
 for(const actor of ['governor','clinician'])sql.prepare("INSERT OR IGNORE INTO clinical_hq_staff VALUES(?,'clinician',1,'TEST-ONLY','GMC',?,?)").run(s.actors[actor].user.id,'SYNTHETIC-'+s.actors[actor].user.id,future);
}
export async function authoriseCurrentTestCatalogue(f,partnerId='test-pharmacy'){
 if(!currentCoreRoot)return;
 const {s,env,result,record,ctx}=f;prepareTestProfessionals(f);await ensurePlatformSchema(env.DB);
 Object.assign(env,{HQ_CATALOGUE_V31_TEST_MODE:'true',DEPLOYMENT_ENVIRONMENT:'test',HQ_V3_TEST_MODE:'true',PHARMACY_CATALOGUE_PARTNER_ID:partnerId});
 const load=name=>import(pathToFileURL(path.join(currentCoreRoot,name)));
 const {hqCatalogueRoutes}=await load('hq-catalogue-v1.js');
 const {ensureCatalogueGovernanceSchema,readCatalogueAuthority}=await load('hq-catalogue-governance-v31.mjs');
 await ensureCatalogueGovernanceSchema(env.DB);
 const version=s.sql.prepare('SELECT catalogue_version FROM medicine_variants WHERE id=9911').get().catalogue_version;
 const body={version,request_id:crypto.randomUUID(),routes:[{partner_id:partnerId,role:'primary',readiness:'ready',stock_on_hand:20,authority:true,availability:'available',authority_until:new Date(Date.now()+3600000).toISOString(),evidence_ref:'TEST-STOCK-RECEIPT'}]};
 await result('Owner saves versioned TEST supplier authority',hqCatalogueRoutes(new Request('https://api.shiftsometimber.co.uk/v1/hq/catalogue/governance/medicine-variants/9911/suppliers',{method:'POST',headers:{Origin:'https://hq.shiftsometimber.co.uk',Cookie:s.ownerSession,'Content-Type':'application/json'},body:JSON.stringify(body)}),env,ctx));
 const before=await readCatalogueAuthority(env.DB,9911);if(before.canBuy||!before.blockers.includes('current_prescriber_signoff_required'))throw Error('Missing catalogue sign-off did not block purchase');
 env.CATALOGUE_SIGNOFF_TEST_GRANTS=JSON.stringify([{user_id:s.actors.clinician.user.id,org_id:'test-clinical-org',variant_id:9911,permission:'catalogue_signoff',approval_ref:'TEST-NATIVE-CURRENT-CATALOGUE',expires_at:new Date(Date.now()+3600000).toISOString()}]);
 const versions=s.sql.prepare('SELECT m.catalogue_version productVersion,v.catalogue_version variantVersion FROM medicine_variants v JOIN medicine_products m ON m.id=v.medicine_id WHERE v.id=9911').get();
 const request=actor=>new Request('https://api.shiftsometimber.co.uk/v1/hq/clinical/platform/catalogue/9911',{method:'POST',headers:{Origin:'https://hq.shiftsometimber.co.uk',Cookie:s.actors[actor].session,'Content-Type':'application/json'},body:JSON.stringify({...versions,acknowledge:true})});
 await result('HQ owner cannot provide prescriber catalogue sign-off',clinical.fetch(request('owner'),env,ctx),403);
 const signed=await result('Native MFA prescriber signs exact catalogue version',clinical.fetch(request('clinician'),env,ctx));
 const truth=await readCatalogueAuthority(env.DB,9911);if(!truth.canBuy||truth.selectedPartner!==partnerId)throw Error('Current native catalogue authority did not become ready');
 f.report.catalogue={variantId:9911,approvalId:signed.approval.id,who:signed.approval.who,productVersion:versions.productVersion,variantVersion:versions.variantVersion,partnerId,synthetic:true,ownerDenied:true,patientPrescriptionCreated:false};
 (f.report.catalogueApprovals||=[]).push({...f.report.catalogue});
 record('Current v3.1 catalogue authority','PASS (SYNTHETIC)','Actual owner supplier save, owner sign-off denial, authenticated MFA prescriber approval and actual Core purchase guard use the same native TEST records. No regulator or supplier commissioning is implied.');
}
