import test from 'node:test';
import assert from 'node:assert/strict';
import {qaPageRequestAllowed} from '../qa/page-navigation.mjs';
const req=(headers={},path='/qa/start',method='GET',host='my-qa.sstrx.co.uk')=>new Request('https://'+host+path,{method,headers});
test('Reviewer return admits a protected top-level document without admitting cross-site fetches or frames',()=>{
 const top={'Sec-Fetch-Site':'cross-site','Sec-Fetch-Mode':'navigate','Sec-Fetch-Dest':'document'};
 assert.equal(qaPageRequestAllowed(req(top)),true);
 for(const changed of [{'Sec-Fetch-Dest':'iframe'},{'Sec-Fetch-Dest':'empty'},{'Sec-Fetch-Mode':'cors'},{Origin:'https://unrelated.example'}])assert.equal(qaPageRequestAllowed(req({...top,...changed})),false);
 assert.equal(qaPageRequestAllowed(req(top,'/v1/member/my-shift')),false);
 for(const method of ['POST','PUT','DELETE'])assert.equal(qaPageRequestAllowed(req(top,'/qa/start',method)),false);
});
test('Ordinary same-origin page requests remain valid and unrelated production or alternate hosts stay denied',()=>{
 assert.equal(qaPageRequestAllowed(req()),true);
 assert.equal(qaPageRequestAllowed(req({Origin:'https://my-qa.sstrx.co.uk'})),true);
 assert.equal(qaPageRequestAllowed(req({Origin:'https://unrelated.example'})),false);
 for(const host of ['shiftsometimber.co.uk','my-qa.sstrx.co.uk.attacker.example','localhost'])assert.equal(qaPageRequestAllowed(req({},'/qa/start','GET',host)),false);
});
