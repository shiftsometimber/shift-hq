import {QA_ACCESS} from './access-config.mjs';

const encoder = new TextEncoder(), decoder = new TextDecoder('utf-8', {fatal: true});
const denied = (status = 403) => Response.json({error: status === 503 ? 'qa_access_unavailable' : 'qa_access_required'}, {
  status, headers: {'Cache-Control': 'no-store, private', 'X-Content-Type-Options': 'nosniff', 'X-Robots-Tag': 'noindex, nofollow'},
});
const reject = () => { throw Object.assign(Error('invalid_access_assertion'), {status: 403}); };
function decode(value) {
  if (!value || !/^[A-Za-z0-9_-]+$/.test(value)) return reject();
  try { return Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0)); }
  catch { return reject(); }
}
async function boundedJson(response) {
  if (!response.ok || response.redirected || Number(response.headers.get('Content-Length') || 0) > 100000) throw Error('keys_unavailable');
  const reader = response.body?.getReader();
  if (!reader) throw Error('keys_unavailable');
  let length = 0; const parts = [];
  for (;;) {
    const {done, value} = await reader.read(); if (done) break;
    length += value.byteLength;
    if (length > 100000) { await reader.cancel(); throw Error('keys_unavailable'); }
    parts.push(value);
  }
  const body = new Uint8Array(length); let offset = 0;
  for (const part of parts) { body.set(part, offset); offset += part.byteLength; }
  return JSON.parse(decoder.decode(body));
}

// The runtime uses only the fixed account issuer. Test injection never comes from env,
// headers, query parameters or JWT-provided jku/x5u URLs.
export function createQaAccessBoundary(handler, {fetchKeys = (...args) => fetch(...args), now = () => Date.now()} = {}) {
  let keys = new Map(), validUntil = 0, refreshedAt = -Infinity, pending;
  async function refresh() {
    if (pending) return pending;
    const startedAt = now();
    refreshedAt = startedAt;
    pending = (async () => {
      const response = await fetchKeys(QA_ACCESS.issuer + '/cdn-cgi/access/certs', {redirect: 'error', signal: AbortSignal.timeout(5000)});
      const data = await boundedJson(response);
      if (!Array.isArray(data.keys) || !data.keys.length || data.keys.length > 20) throw Error('keys_unavailable');
      const next = new Map();
      for (const jwk of data.keys) {
        if (jwk.kty !== 'RSA' || jwk.alg && jwk.alg !== 'RS256' || jwk.use && jwk.use !== 'sig' || jwk.d || !/^[A-Za-z0-9_-]{1,128}$/.test(jwk.kid || '')) continue;
        if (next.has(jwk.kid)) throw Error('duplicate_key_id');
        const key = await crypto.subtle.importKey('jwk', jwk, {name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256'}, false, ['verify']);
        if (key.algorithm.modulusLength < 2048) throw Error('weak_access_key');
        next.set(jwk.kid, key);
      }
      if (!next.size) throw Error('keys_unavailable');
      keys = next; validUntil = startedAt + 300000;
    })().finally(() => { pending = undefined; });
    return pending;
  }
  async function verify(request) {
    const assertion = request.headers.get('Cf-Access-Jwt-Assertion');
    if (!assertion || assertion.length > 16000) return reject();
    const parts = assertion.split('.'); if (parts.length !== 3) return reject();
    let header, claims;
    try { header = JSON.parse(decoder.decode(decode(parts[0]))); claims = JSON.parse(decoder.decode(decode(parts[1]))); }
    catch { return reject(); }
    if (!header || header.alg !== 'RS256' || header.typ !== 'JWT' || header.crit || header.jku || header.x5u || !/^[A-Za-z0-9_-]{1,128}$/.test(header.kid || '')) return reject();
    const timestamp = Math.floor(now() / 1000);
    if (!claims || claims.iss !== QA_ACCESS.issuer || !Array.isArray(claims.aud) || !claims.aud.includes(QA_ACCESS.audience) || claims.type !== 'app' ||
        !Number.isInteger(claims.exp) || !Number.isInteger(claims.iat) || claims.exp <= timestamp || claims.iat > timestamp + 30 ||
        claims.exp <= claims.iat || claims.exp - claims.iat > QA_ACCESS.maxSessionSeconds ||
        claims.nbf !== undefined && (!Number.isInteger(claims.nbf) || claims.nbf > timestamp) ||
        typeof claims.email !== 'string' || !QA_ACCESS.emails.includes(claims.email.toLowerCase())) return reject();
    if (pending) await pending;
    if (now() >= validUntil) {
      if (now() - refreshedAt < 30000) throw Error('keys_temporarily_unavailable');
      await refresh();
    } else if (!keys.has(header.kid) && now() - refreshedAt >= 30000) await refresh();
    const key = keys.get(header.kid); if (!key) return reject();
    let signatureValid = false;
    try { signatureValid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, decode(parts[2]), encoder.encode(parts[0] + '.' + parts[1])); }
    catch { return reject(); }
    if (!signatureValid) return reject();
  }
  return {async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.protocol !== 'https:' || !QA_ACCESS.hosts.includes(url.hostname) || url.port) return denied();
    if (env.SSTRX_ENVIRONMENT !== 'synthetic') return denied(503);
    try { await verify(request); }
    catch (error) { return denied(error.status === 403 ? 403 : 503); }
    // Access is an outer gate, never a source of native roles or impersonation.
    const headers = new Headers(request.headers);
    for (const name of ['Cf-Access-Jwt-Assertion', 'Cf-Access-Authenticated-User-Email', 'X-QA-Access-Email']) headers.delete(name);
    const cookies = (headers.get('Cookie') || '').split(';').map(x => x.trim()).filter(x => x && !/^CF_Authorization=/i.test(x));
    if (cookies.length) headers.set('Cookie', cookies.join('; ')); else headers.delete('Cookie');
    return handler.fetch(new Request(request, {headers}), env, ctx);
  }};
}
