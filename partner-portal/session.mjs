export const SESSION_COOKIE = '__Host-shift_partner';
export const MFA_COOKIE = '__Host-shift_partner_mfa';
export const HOST = 'partner.shiftsometimber.co.uk';
export const ORIGIN = 'https://' + HOST;
const enc = new TextEncoder(), dec = new TextDecoder();
const b64 = bytes => btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
const unb64 = value => Uint8Array.from(atob(value.replaceAll('-','+').replaceAll('_','/')), c=>c.charCodeAt(0));
async function key(secret) {
  if (!/^[a-f0-9]{64}$/i.test(secret || '')) throw Error('session_key_unavailable');
  return crypto.subtle.importKey('raw', Uint8Array.from(secret.match(/../g), h=>parseInt(h,16)), 'AES-GCM', false, ['encrypt','decrypt']);
}
export async function seal(payload, secret, audience, ttl = 3600, now = Date.now()) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = enc.encode(JSON.stringify({...payload, aud:audience, exp:now + Math.min(ttl,3600)*1000}));
  const cipher = await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:enc.encode(ORIGIN+'|'+audience)}, await key(secret), data);
  return b64(iv)+'.'+b64(new Uint8Array(cipher));
}
export async function unseal(value, secret, audience, now = Date.now()) {
  try {
    if (!value || value.length > 6000) return null;
    const parts=value.split('.'); if(parts.length!==2)return null;
    const iv=unb64(parts[0]); if(iv.length!==12)return null;
    const raw=await crypto.subtle.decrypt({name:'AES-GCM',iv,additionalData:enc.encode(ORIGIN+'|'+audience)},await key(secret),unb64(parts[1]));
    const data=JSON.parse(dec.decode(raw));
    return data.aud===audience && Number.isFinite(data.exp) && data.exp>now && data.exp<=now+3600000 ? data:null;
  } catch { return null; }
}
export function cookieValue(request, name) {
  const matches=(request.headers.get('Cookie')||'').split(';').map(x=>x.trim()).filter(x=>x.startsWith(name+'='));
  return matches.length===1 ? matches[0].slice(name.length+1) : '';
}
export const setCookie = (name, value, ttl) => name+'='+value+'; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age='+ttl;
export function upstreamSession(response) {
  const values=response.headers.getSetCookie?.() || [response.headers.get('Set-Cookie')||''];
  for(const value of values){
    const m=value.match(/(?:^|,\s*)sst_hq_session=([A-Za-z0-9._~-]{16,2048})(?:;|$)/);
    if(m){const age=value.match(/Max-Age=(\d+)/i); return {token:m[1],ttl:Math.min(3600,age?Number(age[1]):3600)};}
  }
  return null;
}
