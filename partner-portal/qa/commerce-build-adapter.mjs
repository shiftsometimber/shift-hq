// Four explicit outbound call sites are replaced only in the private Core
// build. Original and transformed hashes are recorded. Production inputs stay
// untouched; unknown Core layouts fail the build rather than using the network.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
const expected={'medicine-commerce-v1.js':2,'checkout-attempt-v1.mjs':1,'pharmacy-handover-v1.mjs':1};
export function commerceBuildAdapter(core,qa,receipts){
 return{name:'isolated-native-commerce-transport',setup(build){build.onLoad({filter:/(?:medicine-commerce-v1\.js|checkout-attempt-v1\.mjs|pharmacy-handover-v1\.mjs)$/},async args=>{
  const name=path.basename(args.path);if(args.path!==path.join(core,name))return;
  const source=await fs.readFile(args.path,'utf8'),matches=[...source.matchAll(/(?<![\w$.])fetch\(/g)];if(matches.length!==expected[name])throw Error('Native outbound call contract changed: '+name);
  const transformed='import {qaCommerceFetch} from '+JSON.stringify(path.join(qa,'commerce-transport.mjs'))+';\n'+source.replace(/(?<![\w$.])fetch\(/g,'qaCommerceFetch(env,');
  const hash=s=>createHash('sha256').update(s).digest('hex');receipts.push({source:args.path,calls:matches.length,sourceSha256:hash(source),privateBuildSha256:hash(transformed)});
  return{contents:transformed,loader:'js',resolveDir:core};
 });}};
}
