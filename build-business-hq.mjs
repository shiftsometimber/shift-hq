import fs from 'node:fs';
import path from 'node:path';
const root=path.dirname(new URL(import.meta.url).pathname),dest=path.join(root,'.site-build');
const assets=['index.html','hq.js','hq-v111.js','hq.css','hq-knowledge-editorial.css','hq-evidence-desk.css','turnstile-auth-v1.js','hq-management.js','hq-management.css','hq-partners.js','hq-partners.css','hq-partner-workflows.js','gp-directory.js','hq-business.js','hq-business.css','hq-business-export.js'];
fs.mkdirSync(dest,{recursive:true});for(const name of fs.readdirSync(dest))fs.rmSync(path.join(dest,name),{recursive:true,force:true});
for(const name of assets)fs.copyFileSync(path.join(root,name),path.join(dest,name));
console.log('Built '+assets.length+' explicitly allowed public HQ files.');
