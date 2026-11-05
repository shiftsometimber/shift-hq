import {createHash} from 'node:crypto';
import {brotliCompressSync,constants} from 'node:zlib';
const selector='#mtShopMain,#main-content,#previewMember,main';
export function repairAccountBoundary(source){
 if(source.split(selector).length!==2)throw Error('Exact retained-content selector must occur once');
 const at=source.indexOf(selector),end=source.indexOf(';if(!Me)',at);
 if(end<at||end-at>120)throw Error('Original account boundary must be reconciled');
 // Preserve the page root needed by its scoped CSS and event controller. Avoid
 // duplicate standalone branding inside the existing native application chrome.
 const insertion=";if(Me&&Me.id==='my-shift'){Me.querySelector('.ms-top')?.remove();Me.querySelector('.ms-footer')?.remove();}";
 const cache='if(w.has(Q))return w.get(Q).value;';
 if(source.split(cache).length!==2)throw Error('Original retained cache boundary must be reconciled');
 const repairedCache="if(w.has(Q)){let saved=w.get(Q).value;if(saved?.dataset?.memberPage!=='my-shift'||new DOMParser().parseFromString(saved.html,'text/html').getElementById('my-shift'))return saved;w.delete(Q);}";
 return (source.slice(0,end)+insertion+source.slice(end)).replace(selector,'#my-shift,'+selector).replace(cache,repairedCache);
}
export function patchProgramme(source){
 const oldVersion='d1233652ca0fb4bbf266',uses=source.split(oldVersion).length-1;
 if(uses!==24)throw Error('Current native release version must be reconciled');
 const repaired=repairAccountBoundary(source),version=createHash('sha256').update(repaired+'account-boundary-brotli-v2').digest('hex').slice(0,20);
 return {source:repaired.replaceAll(oldVersion,version),previousVersion:oldVersion,version,versionReferences:uses};
}
export function refreshNativeBrotli(source,client){
 if(!client.includes('#my-shift,#mtShopMain')||!client.includes("saved?.dataset?.memberPage!=='my-shift'"))throw Error('Plain native client does not contain the qualified account fix');
 const matches=[...source.matchAll(/\bbr="([A-Za-z0-9+/=]+)"/g)];if(matches.length!==1)throw Error('Exact native Brotli asset must be reconciled');
 const encoded=brotliCompressSync(Buffer.from(client),{params:{[constants.BROTLI_PARAM_QUALITY]:11}}).toString('base64');
 return source.replace(matches[0][0],'br="'+encoded+'"');
}
