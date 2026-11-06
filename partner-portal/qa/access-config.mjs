// Public deployment identifiers, read back from the approved Access application.
// These values grant no native member, clinical, pharmacy or owner permissions.
export const QA_ACCESS = Object.freeze({
  applicationId: 'f5a742b7-16e0-4d38-beb8-8a5cb3f6df46',
  policyId: '6191cb04-d628-45f5-9df9-5851973fdd26',
  issuer: 'https://little-queen-e78e.cloudflareaccess.com',
  audience: 'd7e00b4b7ba7072df594592b1af11131f13e5f4a6f538eacf0083e4e60a6deed',
  hosts: Object.freeze(['rx-qa.sstrx.co.uk', 'hq-qa.sstrx.co.uk', 'my-qa.sstrx.co.uk', 'api-qa.sstrx.co.uk']),
  emails: Object.freeze(['matt@shiftsometimber.co.uk', 'shiftsometimber@gmail.com', 'sstrx@shiftsometimber.co.uk']),
  maxSessionSeconds: 1800,
});
export const QA_RX_ORIGIN = 'https://rx-qa.sstrx.co.uk';
export const QA_MEMBER_LOGIN = 'https://my-qa.sstrx.co.uk/member-login?returnTo=%2Fmember%2Fmy-shift';
