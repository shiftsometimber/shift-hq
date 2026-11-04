// Coarse, explicitly consented first-touch labels only. Never retain campaign
// text, URLs, search terms, click IDs, identity or health data in attribution.
export const VERSION='acquisition-v1';
export const BROWSER_TTL=30*86400000;
export const RECORD_TTL=90*86400000;
export const PAIRS=Object.freeze({google:['organic','cpc'],bing:['organic','cpc'],chatgpt:['referral'],claude:['referral'],grok:['referral'],meta_ai:['referral'],copilot:['referral'],gemini:['referral'],perplexity:['referral'],facebook:['social','paid_social'],instagram:['social','paid_social'],x:['social','paid_social'],linkedin:['social','paid_social'],tiktok:['social','paid_social'],email:['email'],newsletter:['email'],partner:['referral'],referral:['referral'],direct_or_unknown:['none']});
export function validPair(source,medium){return typeof source==='string'&&Object.hasOwn(PAIRS,source)&&PAIRS[source].includes(medium)}
export function normaliseAcquisition(value,now=Date.now()){
 if(!value||typeof value!=='object'||Array.isArray(value)||value.version!==VERSION||value.consent!==true||!validPair(value.source,value.medium))return null;
 const captured=Date.parse(value.capturedAt),consented=Date.parse(value.consentAt);
 if(!Number.isFinite(captured)||!Number.isFinite(consented)||captured>now||consented>now||consented>captured||now-captured>BROWSER_TTL||now-consented>BROWSER_TTL)return null;
 return {version:VERSION,model:'first_consented_touch_30d',source:value.source,medium:value.medium,consent:true,consentAt:new Date(consented).toISOString(),capturedAt:new Date(captured).toISOString(),expiresAt:new Date(now+RECORD_TTL).toISOString()};
}
export function registrationMetadata(body,now=Date.now()){
 const acquisition=normaliseAcquisition(body?.acquisition,now);
 return JSON.stringify(acquisition?{acquisition}:{});
}

// Dedicated assistant hosts only; embedded AI cannot be inferred from search/social.
export const AI_REFERRER_HOSTS=Object.freeze({'chatgpt.com':'chatgpt','chat.openai.com':'chatgpt','claude.ai':'claude','grok.com':'grok','meta.ai':'meta_ai','copilot.microsoft.com':'copilot','copilot.com':'copilot','gemini.google.com':'gemini','perplexity.ai':'perplexity'});

