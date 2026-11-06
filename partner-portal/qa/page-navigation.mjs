import {QA_ACCESS} from './access-config.mjs';
// Only protected, read-only top-level documents may return from the external
// reviewer sign-in. Native APIs keep their existing cross-site/CSRF rejection.
export function qaPageRequestAllowed(request){
 const url=new URL(request.url),origin=request.headers.get('Origin');
 if(url.protocol!=='https:'||url.port||!QA_ACCESS.hosts.includes(url.hostname)||url.pathname.startsWith('/v1/')||!['GET','HEAD'].includes(request.method)||origin&&origin!==url.origin)return false;
 if(request.headers.get('Sec-Fetch-Site')!=='cross-site')return true;
 return request.headers.get('Sec-Fetch-Mode')==='navigate'&&request.headers.get('Sec-Fetch-Dest')==='document';
}
