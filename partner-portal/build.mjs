import fs from 'node:fs/promises';
const root=new URL('.',import.meta.url),output=new URL('../.partner-qa/worker.bundle.mjs',import.meta.url);
const names=['ui.mjs','session.mjs','policy.mjs','hq-client.mjs','worker.mjs'];
const source=[];
for(const name of names){
  let code=await fs.readFile(new URL(name,root),'utf8');
  code=code.replace(/^import .*;\r?\n/gm,'').replace(/^export (?!default)/gm,'');
  source.push('// partner-portal/'+name+'\n'+code);
}
await fs.mkdir(new URL('.',output),{recursive:true});
await fs.writeFile(output,source.join('\n'));
console.log('Partner Worker bundle prepared. No dependencies or business data included.');
