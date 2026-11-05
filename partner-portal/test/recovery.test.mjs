// Software recovery exercise only. Not a claim that production D1/R2 was restored.
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync,backup} from 'node:sqlite';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fixture,ORDER} from './fixture.mjs';
import {wrapDatabase} from './database.mjs';
import {reviewAndPropose,issue} from './workflow-helpers.mjs';
import {drainSharedWorkflow} from '../service/shared-workflow.mjs';
test('restored SQLite snapshot retains signatures, ownership and history; uncertain outbox acknowledgement replays without duplicate order events',async()=>{
 const f=await fixture(),directory=await mkdtemp(join(tmpdir(),'sstrx-recovery-'));let restored;
 try{const r=await reviewAndPropose(f);await issue(f,r.cookie,r.proposal);const before=f.sql.prepare('SELECT COUNT(*) n FROM medicine_prescription_events').get().n,signatures=f.sql.prepare('SELECT COUNT(*) n FROM clinical_prescription_signatures').get().n;
 const source=f.sql.prepare("SELECT id FROM partner_workflow_sync WHERE status='completed' ORDER BY id DESC LIMIT 1").get();assert(source);f.sql.prepare("UPDATE partner_workflow_sync SET status='pending',completed_at=NULL WHERE id=?").run(source.id);
 const file=join(directory,'snapshot.sqlite');await backup(f.sql,file);restored=wrapDatabase(new DatabaseSync(file,{enableDoubleQuotedStringLiterals:true}));const d=await drainSharedWorkflow({...f.env,DB:restored.DB},{orderNumber:ORDER});assert.equal(d.pending,0);assert.equal(restored.sql.prepare('SELECT COUNT(*) n FROM medicine_prescription_events').get().n,before);assert.equal(restored.sql.prepare('SELECT COUNT(*) n FROM clinical_prescription_signatures').get().n,signatures);assert.equal(restored.sql.prepare('SELECT COUNT(*) n FROM clinical_case_assignments WHERE active=1').get().n,1);assert.equal(restored.sql.prepare('SELECT clinical_status FROM medicine_orders').get().clinical_status,'sent_to_pharmacy');assert.equal((await drainSharedWorkflow({...f.env,DB:restored.DB},{orderNumber:ORDER})).completed,0);
 }finally{restored?.close();f.close();await rm(directory,{recursive:true,force:true});}
});
