import member from '../../service/member-service.mjs';
import {RECORD} from '../fixture.mjs';
export async function completeAssessment(f){const source=await member.fetch(new Request('https://shiftsometimber.co.uk/assets/clinical-records/schema.mjs'),f.env);const {fields,active}=await import('data:text/javascript;base64,'+Buffer.from(await source.text()).toString('base64'));
 const answers={...JSON.parse(f.sql.prepare('SELECT answers_json FROM clinical_member_versions').get().answers_json),requestPath:'Starting treatment',heightCm:'175',weightKg:'100',phone:'07700900000',deliveryAddress:'FICTIONAL ADDRESS',deliveryPostcode:'AA1 1AA',gpSharingChoice:'Yes',treatmentConfirmation:'I confirm',forMyself:'Yes',inUK:'Yes',insulinUse:'No',urgentSymptoms:'No'};
 for(let n=0;n<3;n++)for(const q of fields){if(!active(q,answers)||q.optional||answers[q.id]!==undefined)continue;answers[q.id]=q.type==='multi'?JSON.stringify([q.options.includes('None of the above')?'None of the above':q.options[0]]):q.options?(q.options.includes('No')?'No':q.options[0]):q.type==='number'?'1':q.type==='date'?'1980-01-01':'FICTIONAL acceptance test';}
 f.sql.prepare('UPDATE clinical_member_versions SET answers_json=? WHERE record_id=?').run(JSON.stringify(answers),RECORD);f.sql.prepare('INSERT INTO clinical_member_evidence VALUES(?,?,?,?,?,?,?,?)').run('scale-fixture',RECORD,'fictional/scale','scale_photo','image/png',1,'TEST-SCALE-HASH',new Date().toISOString());

return f;
}
