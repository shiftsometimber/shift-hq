import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {repairAccountBoundary,patchProgramme,refreshNativeBrotli} from '../platform/account-boundary-fix.mjs';
import {brotliCompressSync,brotliDecompressSync} from 'node:zlib';
const fixture=JSON.parse(fs.readFileSync(new URL('./fixtures/public-account-boundary.json',import.meta.url),'utf8'));
test('retained account extraction keeps its CSS/controller root and invalidates only broken account cache entries',()=>{
 const fixed=repairAccountBoundary(fixture.legacyLoader);assert(fixed.includes('#my-shift,#mtShopMain'));assert(fixed.includes("saved?.dataset?.memberPage!=='my-shift'"));assert(fixed.includes("querySelector('.ms-top')?.remove()"));
 assert(fixed.includes('credentials:"same-origin"'));assert(fixed.includes('Your account changed.'));assert(fixed.includes('X-My-Timber-Account'));assert.throws(()=>repairAccountBoundary(fixed));assert.throws(()=>repairAccountBoundary('unrelated source'));
});
test('compressed native asset is regenerated from the corrected plain client',()=>{
 const client=repairAccountBoundary(fixture.legacyLoader),old=brotliCompressSync(Buffer.from('old broken native client')).toString('base64');
 const source='const unrelated="preserved";var br="'+old+'";const tail=true;',patched=refreshNativeBrotli(source,client),encoded=patched.match(/br="([A-Za-z0-9+/=]+)"/)[1];
 assert.equal(brotliDecompressSync(Buffer.from(encoded,'base64')).toString('utf8'),client);assert(patched.startsWith('const unrelated="preserved";'));assert(patched.endsWith('const tail=true;'));assert.throws(()=>refreshNativeBrotli(source,'old broken native client'));
});
test('release version changes with the boundary fix, while unexpected native builds fail closed',()=>{
 const source=fixture.legacyLoader+'\n'+Array(24).fill('d1233652ca0fb4bbf266').join(' '),patched=patchProgramme(source);assert.equal(patched.versionReferences,24);assert.equal(patched.source.includes(patched.previousVersion),false);assert.match(patched.version,/^[a-f0-9]{20}$/);assert.throws(()=>patchProgramme(fixture.legacyLoader));
});
