// Isolated deployment adapter over the unchanged native identity/API handlers.
// It is not an account store, role source, public proxy or production entry.
import {createQaAccessBoundary} from './access-boundary.mjs';
import {QA_ACCESS} from './access-config.mjs';
const denied=(status=403)=>Response.json({error:status===503?'qa_origin_configuration_unavailable':'qa_origin_required'},{status,headers:{'Cache-Control':'no-store, private','X-Robots-Tag':'noindex, nofollow','X-Content-Type-Options':'nosniff'}});
const nativeHosts=new Set(['api.shiftsometimber.co.uk','shiftsometimber.co.uk','www.shiftsometimber.co.uk','hq.shiftsometimber.co.uk']);
function cookies(response){
 if(response.headers.getSetCookie)return response.headers.getSetCookie();
 if(response.headers.getAll)return response.headers.getAll('Set-Cookie');
 if(!response.headers.has('Set-Cookie'))return [];
 throw Error('cookie_collection_unavailable');
}
function hostCookie(value){
 const parts=value.split(';').map(x=>x.trim()),attributes=parts.slice(1);
 if(!/^[A-Za-z0-9_-]+=/.test(parts[0])||!attributes.some(x=>/^Secure$/i.test(x))||!attributes.some(x=>/^HttpOnly$/i.test(x)))throw Error('native_cookie_security_missing');
 for(const item of attributes.filter(x=>/^Domain=/i.test(x)))if(!/^Domain=\.?shiftsometimber\.co\.uk$/i.test(item))throw Error('unexpected_native_cookie_domain');
 return [parts[0],...attributes.filter(x=>!/^Domain=/i.test(x))].join('; ');
}
function nativeCookies(response){
 const raw=cookies(response);
 // Native member login first issues the shared-domain session, then expires
 // its legacy production host cookie. Both would become the SAME QA host-only
 // cookie after mapping. Keep the new session, not that obsolete cleanup.
 const replacesLegacy=raw.some(c=>/^sst_session=[^;]/.test(c)&&/;\s*Domain=\.?shiftsometimber\.co\.uk(?:;|$)/i.test(c)&&!/;\s*Max-Age=0(?:;|$)/i.test(c));
 return raw.filter(c=>!(replacesLegacy&&/^sst_session=;/.test(c)&&!/;\s*Domain=/i.test(c)&&/;\s*Max-Age=0(?:;|$)/i.test(c))).map(hostCookie);
}
export function createQaNativeOrigin(handler,{host}={},accessOptions){
 if(!QA_ACCESS.hosts.includes(host)||host==='rx-qa.sstrx.co.uk')throw Error('unsupported_native_qa_host');
 const origin='https://'+host;
 const native={async fetch(request,env,ctx){
  const url=new URL(request.url),supplied=request.headers.get('Origin');
  const cataloguePage=host==='hq-qa.sstrx.co.uk'&&url.pathname==='/hq/catalogue-controls'&&['GET','HEAD'].includes(request.method);
  const legacyCrm=host==='hq-qa.sstrx.co.uk'&&url.pathname.startsWith('/v1/crm/');
  const authConfig=host==='hq-qa.sstrx.co.uk'&&url.pathname==='/v1/auth/turnstile-config'&&request.method==='GET';
  if(url.origin!==origin||!url.pathname.startsWith('/v1/')&&!cataloguePage||request.headers.get('Sec-Fetch-Site')==='cross-site'||supplied&&supplied!==origin||!['GET','HEAD'].includes(request.method)&&supplied!==origin)return denied();
  if(host==='my-qa.sstrx.co.uk'&&url.pathname.startsWith('/v1/hq/'))return denied();
  if(host==='hq-qa.sstrx.co.uk'&&!url.pathname.startsWith('/v1/hq/')&&!cataloguePage&&!legacyCrm&&!authConfig)return denied();
  const logical=url.pathname.startsWith('/v1/hq/')||cataloguePage||legacyCrm||authConfig?'https://hq.shiftsometimber.co.uk':'https://shiftsometimber.co.uk';
  const headers=new Headers(request.headers);headers.delete('Host');
  if(supplied)headers.set('Origin',logical);
  // The public origin has already been checked. Native CSRF/session/role checks
  // still run on the original handlers through the private service boundary.
  url.hostname='api.shiftsometimber.co.uk';
  const response=await handler.fetch(new Request(url,new Request(request,{headers})),env,ctx);
  try{
   const output=new Headers(response.headers);output.delete('Set-Cookie');
   for(const cookie of nativeCookies(response))output.append('Set-Cookie',cookie);
   const location=output.get('Location');
   if(location){const target=new URL(location,url);if(!nativeHosts.has(target.hostname)||target.protocol!=='https:'||target.port)throw Error('external_redirect_not_admitted');output.set('Location',origin+target.pathname+target.search+target.hash);}
   output.delete('Access-Control-Allow-Origin');output.delete('Access-Control-Allow-Credentials');
   if(supplied===origin){output.set('Access-Control-Allow-Origin',origin);output.set('Access-Control-Allow-Credentials','true');output.append('Vary','Origin');}
   output.set('Cache-Control','no-store, private');output.set('X-Robots-Tag','noindex, nofollow');
   return new Response(response.body,{status:response.status,statusText:response.statusText,headers:output});
  }catch{return denied(503);}
 }};
 return createQaAccessBoundary(native,accessOptions);
}
