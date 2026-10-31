import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
const source=fs.readFileSync(new URL('./hq.js',import.meta.url),'utf8');
const match=source.match(/function radarQueuePath\(eventId\)\{[^\n]+\}/);assert.ok(match);
const path=vm.runInNewContext('('+match[0]+')');
test('default queue remains unchanged and exact event is forwarded',()=>{assert.equal(path(null),'/v1/hq/radar/queue');assert.equal(path('1370'),'/v1/hq/radar/queue?event=1370');assert.match(source,/radarCall\(radarQueuePath\(requestedEvent\)\)/);});
test('query values are encoded rather than concatenated as extra parameters',()=>{assert.equal(path('283&publish=1'),'/v1/hq/radar/queue?event=283%26publish%3D1');});
