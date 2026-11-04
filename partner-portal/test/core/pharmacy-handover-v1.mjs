// SHIFT's provisional transport contract, not a vendor API or clinical protocol.
// Never log request bodies, provider responses, bearer credentials or resume URLs.
export const HANDOVER_VERSION = 'shift-pharmacy-handover-v2-2026-10-16';
export class PharmacyTransportError extends Error {
  constructor(code, uncertain = false) { super(code); this.code = code; this.uncertain = uncertain; }
}
export function pharmacyEndpoint(value) {
  let url;
  try { url = new URL(String(value)); } catch { throw new PharmacyTransportError('pharmacy_configuration_invalid'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash)
    throw new PharmacyTransportError('pharmacy_configuration_invalid');
  return url;
}
export function externalReference(value, required = true) {
  if (!required && (value === undefined || value === null || value === '')) return null;
  if (typeof value !== 'string' || !value.trim() || value !== value.trim() || value.length > 160 || /[\u0000-\u001f\u007f]/.test(value))
    throw new PharmacyTransportError('pharmacy_response_invalid', true);
  return value;
}
export async function digest(value) {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), x => x.toString(16).padStart(2, '0')).join('');
}
export async function evidenceReceipts(files) {
  return Object.fromEntries(await Promise.all(Object.entries(files).map(async ([key, file]) =>
    [key, {bytes:file.size, type:file.type, sha256:await digest(await file.arrayBuffer())}])));
}
export async function pharmacyRequest(env, endpoint, payload, clientReference, {timeoutMs = 15000} = {}) {
  const url = pharmacyEndpoint(endpoint);
  if (!env.PHARMACY_INTEGRATION_SECRET) throw new PharmacyTransportError('pharmacy_configuration_invalid');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const multipart = payload instanceof FormData;
    const response = await fetch(url.href, {
      method:'POST', redirect:'error', cache:'no-store', signal:controller.signal,
      headers:{authorization:`Bearer ${env.PHARMACY_INTEGRATION_SECRET}`, 'Idempotency-Key':clientReference,
        ...(multipart ? {} : {'content-type':'application/json'})},
      body:multipart ? payload : JSON.stringify(payload),
    });
    // A timeout, proxy error or unreadable receipt does not establish non-delivery.
    // Do not blindly replay an assessment whose result is uncertain.
    if (!response.ok) throw new PharmacyTransportError('pharmacy_unavailable', true);
    if (!/application\/json/i.test(response.headers.get('content-type') || '')) throw new PharmacyTransportError('pharmacy_response_invalid', true);
    const reader = response.body?.getReader();
    if (!reader) throw new PharmacyTransportError('pharmacy_response_invalid', true);
    const chunks=[]; let size=0;
    while (true) {
      const {value,done}=await reader.read(); if(done)break;
      size+=value.byteLength;
      if(size>65536){await reader.cancel();throw new PharmacyTransportError('pharmacy_response_invalid',true);}
      chunks.push(value);
    }
    const bytes=new Uint8Array(size);let offset=0;
    for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
    try { return JSON.parse(new TextDecoder().decode(bytes)); }
    catch { throw new PharmacyTransportError('pharmacy_response_invalid', true); }
  } catch (error) {
    if (error instanceof PharmacyTransportError) throw error;
    throw new PharmacyTransportError('pharmacy_delivery_unconfirmed', true);
  } finally { clearTimeout(timer); }
}
export function acceptedReceipt(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new PharmacyTransportError('pharmacy_response_invalid',true);
  const reference=externalReference(value.reference), patientReference=externalReference(value.patientReference,false);
  const status=value.status || (value.verified===true?'verified':'submitted');
  if (!['submitted','more_information_required','verified','declined'].includes(status) ||
      (value.verified===true && status!=='verified') || (status==='verified' && value.verified===false))
    throw new PharmacyTransportError('pharmacy_response_invalid',true);
  // An internal SHIFT ID is not evidence of a resolved provider patient.
  if (status==='verified' && !patientReference) throw new PharmacyTransportError('provider_patient_reference_required',true);
  return {reference,patientReference,status};
}
export function secureResumeUrl(value, expectedOrigin) {
  const origin=pharmacyEndpoint(expectedOrigin);
  let url;try{url=new URL(value);}catch{throw new PharmacyTransportError('pharmacy_resume_invalid');}
  if(url.protocol!=='https:'||url.origin!==origin.origin||url.username||url.password||url.hash)
    throw new PharmacyTransportError('pharmacy_resume_invalid');
  return url.href;
}
