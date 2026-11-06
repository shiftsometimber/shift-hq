import {build} from 'esbuild';
export async function buildMemberNavigation(){const result=await build({entryPoints:[new URL('./platform/member-entry.mjs',import.meta.url).pathname],bundle:true,format:'esm',target:'es2022',write:false});return Buffer.from(result.outputFiles[0].contents);}
