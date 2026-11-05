import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {repairAccountBoundary,patchProgramme} from '../platform/account-boundary-fix.mjs';
const fixture=JSON.parse(fs.readFileSync(new URL('./fixtures/public-account-boundary.json',import.meta.url),'utf8'));
test('retained account extraction keeps its CSS/controller root and invalidates only broken account cache entries',()=>{
 const fixed=repairAccountBoundary(fixture.legacyLoader);assert(fixed.includes('#my-shift,#mtShopMain'));assert(fixed.includes("saved?.dataset?.memberPage!=='my-shift'"));assert(fixed.includes("querySelector('.ms-top')?.remove()"));
 assert(fixed.includes('credentials:"same-origin"'));assert(fixed.includes('Your account changed.'));assert(fixed.includes('X-My-Timber-Account'));assert.throws(()=>repairAccountBoundary(fixed));assert.throws(()=>repairAccountBoundary('unrelated source'));
});
test('release version changes with the boundary fix, while unexpected native builds fail closed',()=>{
 const source=fixture.legacyLoader+'\n'+Array(24).fill('d1233652ca0fb4bbf266').join(' '),patched=patchProgramme(source);assert.equal(patched.versionReferences,24);assert.equal(patched.source.includes(patched.previousVersion),false);assert.match(patched.version,/^[a-f0-9]{20}$/);assert.throws(()=>patchProgramme(fixture.legacyLoader));
});
