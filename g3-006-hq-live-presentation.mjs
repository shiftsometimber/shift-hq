import {chromium} from 'playwright';
import fs from 'node:fs';
const BASE=(process.env.SHIFT_HQ_BASE||'https://hq.shiftsometimber.co.uk').replace(/\/$/,'');
const OUT=process.env.G3_006_HQ_EVIDENCE_DIR||'g3-006-hq-live-evidence';
fs.mkdirSync(OUT,{recursive:true});
const report={proof:'G3_006_HQ_LIVE_PRESENTATION_V1',assets:{},cases:[],failures:[]};
const fail=(name,detail)=>{report.failures.push({name,detail});console.error(`::error title=G3-006 HQ live::${name} — ${detail}`)};
for(const [asset,markers] of Object.entries({
  'index.html':['Knowledge Hub CMS','id="knowledge"'],
  'hq.js':['installKnowledgeEditorialPresentation','Useful first. Reviewed before it goes live.','Editorial review','data-knowledge-publish','/v1/hq/articles/${id}/review'],
  'hq-knowledge-editorial.css':['knowledge-editorial-intro','@media (max-width: 760px)','prefers-reduced-motion']
})){
  const r=await fetch(`${BASE}/${asset}?g3_006=${Date.now()}`,{redirect:'follow'});const text=await r.text();report.assets[asset]={status:r.status,bytes:text.length,markers:Object.fromEntries(markers.map(m=>[m,text.includes(m)]))};if(r.status!==200)fail(`asset-${asset}`,`HTTP ${r.status}`);for(const m of markers)if(!text.includes(m))fail(`asset-marker-${asset}`,m);
}
const browser=await chromium.launch({headless:true});
try{
  for(const [id,viewport] of Object.entries({desktop:{width:1440,height:900},mobile390:{width:390,height:844}})){
    const row={id,viewport,pageErrors:[],consoleErrors:[]};report.cases.push(row);const context=await browser.newContext({viewport,reducedMotion:'reduce'});const page=await context.newPage();page.on('pageerror',e=>row.pageErrors.push(String(e.message||e)));page.on('console',m=>{if(m.type()==='error')row.consoleErrors.push(m.text())});
    try{
      await page.goto(BASE,{waitUntil:'domcontentloaded',timeout:30000});
      await page.waitForFunction(()=>document.querySelector('button[data-view="knowledgehub"]')&&document.querySelector('.knowledge-editorial-intro'),null,{timeout:15000});
      row.rendered=await page.evaluate(()=>{const b=document.querySelector('button[data-view="knowledgehub"]'),s=document.querySelector('#knowledgehub'),intro=document.querySelector('.knowledge-editorial-intro'),head=[...s.querySelectorAll('thead th')].map(x=>x.textContent.trim()),modal=document.querySelector('#loginModal,.modal.login,.login-modal,[data-login-modal]');b.click();const r=s.getBoundingClientRect();return{nav:b.textContent.trim(),sectionId:s.id,intro:intro.innerText.replace(/\s+/g,' ').trim(),headings:head,active:s.classList.contains('active'),rootOverflow:document.documentElement.scrollWidth-document.documentElement.clientWidth,section:{w:Math.round(r.width),left:Math.round(r.left),right:Math.round(r.right)},loginBoundaryVisible:!!modal&&getComputedStyle(modal).display!=='none'};});
      if(!/Knowledge Hub CMS/.test(row.rendered.nav))fail(`${id}-nav`,row.rendered.nav);if(!/Useful first\. Reviewed before it goes live\./.test(row.rendered.intro))fail(`${id}-intro`,row.rendered.intro);if(!row.rendered.headings.includes('Editorial review'))fail(`${id}-review-column`,JSON.stringify(row.rendered.headings));if(row.rendered.rootOverflow>0)fail(`${id}-overflow`,`${row.rendered.rootOverflow}px`);if(!row.rendered.active)fail(`${id}-knowledge-view`,'knowledge section did not activate');if(row.pageErrors.length)fail(`${id}-page-errors`,JSON.stringify(row.pageErrors));
      await page.screenshot({path:`${OUT}/${id}.png`,fullPage:true});
    }catch(e){fail(`${id}-exception`,String(e.message||e).slice(0,1200))}finally{await context.close()}
  }
}finally{await browser.close()}
fs.writeFileSync(`${OUT}/report.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));if(report.failures.length)throw new Error(`G3-006 live HQ presentation failed ${report.failures.length}`);console.log('PASS G3-006 live HQ presentation: production serves the governed Knowledge Hub desk, named-review presentation and reviewed-publish controls at desktop + 390px.');
