const test=require('node:test'),assert=require('node:assert/strict');
const {londonInstant,londonInput}=require('./hq-ticker-controls.js');
test('Ticker scheduling uses London winter/summer offsets and rejects ambiguous or nonexistent DST clock times',()=>{
 assert.equal(londonInstant('2026-11-06T13:30'),'2026-11-06T13:30:00.000Z');assert.equal(londonInstant('2026-07-01T13:30'),'2026-07-01T12:30:00.000Z');assert.equal(londonInput('2026-07-01T12:30:00Z'),'2026-07-01T13:30:00');assert.throws(()=>londonInstant('2026-03-29T01:30'),/does not exist/);assert.throws(()=>londonInstant('2026-10-25T01:30'),/occurs twice/);assert.equal(londonInstant(''),null);assert.throws(()=>londonInstant('2026-02-30T12:00'),/does not exist/);
});
