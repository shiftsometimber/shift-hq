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
