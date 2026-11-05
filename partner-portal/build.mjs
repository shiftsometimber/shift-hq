import {build} from 'esbuild';
await build({entryPoints:[new URL('worker.mjs',import.meta.url).pathname],bundle:true,format:'esm',target:'es2022',outfile:new URL('../.partner-qa/worker.bundle.mjs',import.meta.url).pathname});
console.log('Existing partner gateway bundle prepared with its original module boundaries.');
