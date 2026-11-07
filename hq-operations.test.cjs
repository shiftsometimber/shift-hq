const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readFileSync } = require('node:fs');
const { SOURCE_DEFINITIONS, overdue, metricValue, errorState, canRead, sourceResult, attentionItems, createRequestGate, timestamp } = require('./hq-operations.js');
const now = new Date('2026-11-04T12:00:00Z');
const source = (key, rows) => ({ ...SOURCE_DEFINITIONS.find(s => s.key === key), status: 'available', rows });

test('Production packaging includes the new runtime assets and keeps the isolated fixture out', () => {
  const rules = readFileSync(__dirname + '/.assetsignore', 'utf8').split(/\r?\n/).map(line => line.trim());
  assert.ok(rules.includes('*'));
  for (const path of ['hq-operations.js', 'hq-operations.css']) assert.ok(rules.includes('!' + path), path + ' must be published');
  assert.ok(!rules.some(line => line.startsWith('!.qa-preview')));
  const index = readFileSync(__dirname + '/index.html', 'utf8');
  assert.ok(index.indexOf('<script src="hq-operations.js?') < index.indexOf('<script src="hq-management.js?'));
});

test('Unavailable, null, non-finite and malformed figures never become zero; genuine zero remains zero', () => {
  for (const m of [undefined, { status: 'unavailable', value: 0 }, { status: 'available', value: null }, { status: 'available', value: NaN }, { status: 'available', value: '0' }, { status: 'available', value: Infinity }]) assert.equal(metricValue(m), 'Unavailable');
  assert.equal(metricValue({ status: 'available', value: 0 }), '0');
  assert.equal(metricValue({ status: 'available', value: 248000, unit: 'pence' }), '£2,480.00');
});
test('London date-only due dates remain open until the end of their local calendar day, including DST', () => {
  assert.equal(overdue('2026-10-25', new Date('2026-10-25T23:59:59Z')), false);
  assert.equal(overdue('2026-10-25', new Date('2026-10-26T00:00:00Z')), true);
  assert.equal(overdue('2026-07-01', new Date('2026-07-01T23:00:00Z')), true);
  assert.equal(timestamp('2026-10-25 10:00:00'), Date.parse('2026-10-25T10:00:00Z'));
  assert.equal(overdue('not a date', now), false);
});
test('Completed and cancelled tasks are excluded; overdue and unassigned tasks retain their owner and next action', () => {
  const items = attentionItems(source('tasks', [
    { id: 1, status: 'done', due_at: '2026-11-01' },
    { id: 2, status: 'cancelled', due_at: '2026-11-01' },
    { id: 3, status: 'open', due_at: '2026-11-01', assigned_to: 'Matt', next_action: 'Check the receipt' },
    { id: 4, status: 'open', due_at: '2026-11-10' },
    { id: 5, status: 'open', due_at: '2026-11-10', assigned_to: 'Owner' }
  ]), now);
  assert.deepEqual(items.map(x => x.id), ['3', '4']);
  assert.equal(items[0].owner, 'Matt'); assert.equal(items[0].next, 'Check the receipt');
  assert.equal(items[1].owner, 'Unassigned');
});
test('Support keeps open and waiting records, prioritises urgent work and omits sensitive ticket text', () => {
  const items = attentionItems(source('support', [
    { id: 1, status: 'open', priority: 'normal', subject: 'Private health detail' },
    { id: 2, status: 'waiting' },
    { id: 3, status: 'resolved' },
    { id: 4, status: 'open', priority: 'urgent' }
  ]), now);
  assert.deepEqual(items.map(x => x.id), ['4', '1', '2']);
  assert.ok(!JSON.stringify(items).includes('Private health detail'));
});
test('Blocked/review/overdue handovers need review; closed handovers and future drafts do not', () => {
  const items = attentionItems(source('handovers', [
    { id: 'a', status: 'blocked', reference: 'ORDER-10', owner_name: 'Matt', next_action: 'Check API acknowledgement' },
    { id: 'b', status: 'review' },
    { id: 'c', status: 'draft', due_date: '2026-11-01' },
    { id: 'd', status: 'closed', due_date: '2026-11-01' },
    { id: 'e', status: 'draft', due_date: '2026-11-10' }
  ]), now);
  assert.deepEqual(items.map(x => x.id), ['a', 'c', 'b']);
  assert.equal(items[0].next, 'Check API acknowledgement');
});
test('Uncertain outcomes are for review only; approved, queued, accepted and sent messages are not relabelled', () => {
  const items = attentionItems(source('messages', ['unknown', 'failed', 'queued', 'approved', 'sent', 'provider_accepted', 'draft'].map((status, id) => ({ id, status, recipient: 'private@example.invalid' }))), now);
  assert.deepEqual(items.map(x => x.status), ['unknown', 'failed']);
  assert.ok(items.every(x => x.next.includes('before considering another attempt')));
  assert.ok(!JSON.stringify(items).includes('private@example.invalid'));
});
test('Forbidden, disconnected and failed sources retain distinct states and cannot be counted as empty queues', () => {
  assert.equal(errorState({ status: 401 }).status, 'signedout');
  assert.equal(errorState({ status: 403 }).status, 'restricted');
  assert.equal(errorState({ status: 404 }).status, 'disconnected');
  assert.equal(errorState({ status: 503 }).status, 'error');
  assert.equal(errorState({ name: 'AbortError' }).label, 'Request timed out');
  assert.deepEqual(attentionItems({ key: 'support', status: 'error', rows: [{ id: 1, status: 'open' }] }), []);
  const support = SOURCE_DEFINITIONS[0];
  assert.throws(() => sourceResult(support, {}));
  assert.throws(() => sourceResult(support, { ok: false, tickets: [] }));
  assert.throws(() => sourceResult(support, { tickets: [null] }));
  assert.throws(() => sourceResult(support, { tickets: [{ id: 1 }] }));
  assert.deepEqual(sourceResult(support, { tickets: [] }).rows, []);
  assert.equal(sourceResult(support, { tickets: [], next_cursor: 'next' }).partial, true);
  assert.equal(sourceResult(SOURCE_DEFINITIONS[2], { items: Array(500).fill({ id: 1, status: 'open' }) }).partial, true);
});
test('Source permissions are checked before requesting records; clinician has no operations-role access', () => {
  assert.equal(canRead(SOURCE_DEFINITIONS[0], { role: 'support' }, ['support_read']), true);
  assert.equal(canRead(SOURCE_DEFINITIONS[1], { role: 'content' }, ['content_read']), false);
  assert.equal(canRead(SOURCE_DEFINITIONS[2], { role: 'clinical' }, ['*']), false);
  assert.equal(canRead(SOURCE_DEFINITIONS[2], { role: 'operations' }, []), true);
  assert.equal(canRead(SOURCE_DEFINITIONS[0], null, ['*']), false);
});
test('Late responses cannot render after logout, superseded refresh or a change of signed-in account', () => {
  const gate = createRequestGate(), owner = { id: 1 }, colleague = { id: 2 };
  const first = gate.start(owner); assert.equal(gate.current(first, owner), true);
  assert.equal(gate.current(first, colleague), false); assert.equal(gate.current(first, null), false);
  const next = gate.start(owner); assert.equal(gate.current(first, owner), false); assert.equal(gate.current(next, owner), true);
  gate.cancel(); assert.equal(gate.current(next, owner), false);
  const changed = gate.start(colleague); assert.equal(gate.current(changed, colleague), true); assert.equal(gate.current(changed, owner), false);
});

test('Home includes only partner questions awaiting HQ and keeps message contents out of attention cards',()=>{
 const items=attentionItems(source('partnerquestions',[{id:'one',order_number:'TEST-ORDER',status:'awaiting_hq',priority:'urgent',owner_name:'SHIFT HQ',subject:'Private subject',body:'Private message'},{id:'two',status:'awaiting_partner'},{id:'three',status:'closed'}]),now);
 assert.equal(items.length,1);assert.equal(items[0].view,'partnerdesk');assert.equal(items[0].priority,0);assert.equal(items[0].owner,'SHIFT HQ');assert.ok(!JSON.stringify(items).includes('Private'));
});


test('Attention home dates are TODAY in London and do not depend on report form dates',()=>{
 const {homeReportOptions}=require('./hq-operations.js');
 assert.deepEqual(homeReportOptions(new Date('2026-07-01T23:30:00Z')),{kind:'management',start:'2026-07-02',end:'2026-07-02'});
 assert.deepEqual(homeReportOptions(new Date('2026-11-06T23:30:00Z')),{kind:'management',start:'2026-11-06',end:'2026-11-06'});
});
test('Home Rx projection keeps only safe metadata, excludes ordinary delivered work, and preserves explicit exception ownership',()=>{
 const definition=SOURCE_DEFINITIONS.find(x=>x.key==='rxexceptions');
 const record=(id,action,extra={})=>({case_ref:id,order_ref:'TEST-'+id,partition:'TEST',pharmacy_stage:'delivered',source_updated_at:'2026-11-04T10:00:00Z',action,clinical_body:'DO-NOT-PROJECT-CLINICAL',assessment_answers:{private:'DO-NOT-PROJECT-ANSWERS'},...extra});
 const data={ok:true,partition:'TEST',coverage:{has_more:false},records:[
  record('complete',{kind:'current',code:'delivery_recorded',responsibility:null,unowned:false,overdue:false}),
  record('exception',{kind:'exception',code:'pharmacy_query',label:'Review the reported pharmacy question',responsibility:'pharmacy',owner:{name:'TEST pharmacy owner'},dueAt:'2026-11-04T11:00:00Z',unowned:false,overdue:true},{pharmacy_stage:'query'})
 ]};
 const projected=sourceResult(definition,data),items=attentionItems(projected,now);
 assert.equal(items.length,1);assert.equal(items[0].reference,'TEST-exception');assert.equal(items[0].owner,'TEST pharmacy owner');assert.equal(items[0].due,'2026-11-04T11:00:00Z');
 assert.equal(items[0].createdAt,undefined,'Source update time is not an invented opening time');
 assert.ok(!JSON.stringify(projected.rows).includes('DO-NOT-PROJECT'));
 assert.equal(sourceResult(definition,{...data,coverage:{has_more:true}}).partial,true);
 for(const patch of [{partition:'LIVE'},{records:[{...data.records[0],partition:'LIVE'}]},{records:[{...data.records[0],action:{kind:'exception',code:'x',dueAt:'invalid'}}]}])assert.throws(()=>sourceResult(definition,{...data,...patch}));
});
test('Supplier unknown outcomes open the retained reconciliation workflow, never a retry or acceptance claim',()=>{
 const definition=SOURCE_DEFINITIONS.find(x=>x.key==='supplieroutcomes');
 const projected=sourceResult(definition,{jobs:[
  {id:'unknown',order_number:'TEST-UNKNOWN',state:'uncertain',payload:'DO-NOT-PROJECT-PAYLOAD',updated_at:'2026-11-04T10:00:00Z'},
  {id:'accepted',order_number:'TEST-ACK',state:'transport_received'},
  {id:'future',order_number:'TEST-FUTURE',state:'unrecognised_source_state'}
 ],contracts:[{private:'DO-NOT-PROJECT-CONTRACT'}]});
 const items=attentionItems(projected,now);
 assert.deepEqual(items.map(x=>x.id),['unknown','future']);
 assert.equal(items[0].label,'Supplier outcome unknown');assert.match(items[0].next,/Reconcile the existing submission/);assert.match(items[0].next,/No retry is performed here/);
 assert.equal(definition.url,'https://sstrx.shiftsometimber.co.uk/workspace/finance');assert.equal(definition.actionLabel,'Reconcile state');
 assert.equal(items[0].owner,'Unassigned');assert.equal(items[0].due,undefined);
 assert.ok(!JSON.stringify(projected.rows).includes('DO-NOT-PROJECT'));
});
test('Finance home preserves the native named cover owner and deadline while omitting source details',()=>{
 const definition=SOURCE_DEFINITIONS.find(x=>x.key==='financeexceptions');
 const projected=sourceResult(definition,{owners:[{id:1,name:'TEST original finance owner'},{id:2,name:'TEST cover owner'}],exceptions:[
  {id:'refund:one',orderReference:'TEST-REFUND',state:'watching',kind:'refund_watch',ownerUserId:1,coverOwnerUserId:2,dueAt:'2026-11-04T10:00:00Z',createdAt:'2026-11-03T12:00:00Z',source:{body:'DO-NOT-PROJECT-FINANCE-DETAIL'}},
  {id:'closed',state:'closed',kind:'refund_watch',ownerUserId:1}
 ]});
 const items=attentionItems(projected,now);assert.equal(items.length,1);assert.equal(items[0].owner,'TEST cover owner');assert.equal(items[0].due,'2026-11-04T10:00:00Z');assert.equal(items[0].late,true);
 assert.ok(!JSON.stringify(projected.rows).includes('DO-NOT-PROJECT'));
 assert.throws(()=>sourceResult(definition,{exceptions:[],owners:null}));
 assert.throws(()=>sourceResult(definition,{exceptions:[{id:'bad',state:'open',kind:'variance',dueAt:'invalid'}],owners:[]}));
});
test('Missing finance owner names remain explicit and an unavailable source is never treated as an empty confirmed queue',()=>{
 const definition=SOURCE_DEFINITIONS.find(x=>x.key==='financeexceptions');
 const projection=sourceResult(definition,{exceptions:[{id:'f',state:'open',kind:'reconciliation_variance',ownerUserId:17}],owners:[]});
 const [item]=attentionItems(projection,now);assert.equal(item.owner,'Finance user #17 (name unavailable)');assert.equal(item.due,undefined);
 assert.deepEqual(attentionItems({...projection,status:'error'},now),[]);
 assert.throws(()=>sourceResult(definition,{ok:false,exceptions:[],owners:[]}));
 assert.deepEqual(sourceResult(definition,{exceptions:[],owners:[]}).rows,[]);
});
test('Staff MFA work is active directory metadata only; unknown enrolment is not a confirmed negative or zero',()=>{
 const definition=SOURCE_DEFINITIONS.find(x=>x.key==='staffmfa');
 const projected=sourceResult(definition,{users:[
  {id:1,name:'TEST missing MFA',status:'active',mfa_enabled:0,email:'DO-NOT-PROJECT-EMAIL',password_hash:'DO-NOT-PROJECT-PASSWORD'},
  {id:2,name:'TEST enrolled',status:'active',mfa_enabled:1},
  {id:3,name:'TEST disabled',status:'suspended',mfa_enabled:0},
  {id:4,name:'TEST unknown',status:'active'}
 ]});
 const items=attentionItems(projected,now);assert.deepEqual(items.map(x=>x.id),['1','4']);assert.equal(items[0].label,'Staff MFA enrolment missing');assert.equal(items[1].label,'Staff MFA enrolment unconfirmed');
 assert.ok(items.every(x=>x.view==='users'&&x.owner==='Unassigned'&&x.due===undefined));assert.ok(!JSON.stringify(projected.rows).includes('DO-NOT-PROJECT'));
});
test('New home sources retain role fences before requesting their entitled APIs',()=>{
 for(const key of ['rxexceptions','supplieroutcomes','financeexceptions','staffmfa']){
  const definition=SOURCE_DEFINITIONS.find(x=>x.key===key);assert.equal(canRead(definition,{role:'owner'},['*']),true);assert.equal(canRead(definition,{role:'clinical'},['*']),false);assert.equal(canRead(definition,{role:'support'},['*']),false);
 }
 assert.equal(canRead(SOURCE_DEFINITIONS.find(x=>x.key==='rxexceptions'),{role:'operations'},[]),true);
 assert.equal(canRead(SOURCE_DEFINITIONS.find(x=>x.key==='staffmfa'),{role:'operations'},['*']),false);
});

test('An in-flight supplier submission is pending confirmation, not a fabricated timeout or successful acceptance',()=>{
 const definition=SOURCE_DEFINITIONS.find(x=>x.key==='supplieroutcomes');
 const [item]=attentionItems(sourceResult(definition,{jobs:[{id:'inflight',order_number:'TEST-INFLIGHT',state:'submitting'}]}),now);
 assert.equal(item.label,'Supplier submission awaiting confirmation');assert.doesNotMatch(item.label,/unknown|accepted|success/i);assert.match(item.next,/no new submission or retry/);
});
