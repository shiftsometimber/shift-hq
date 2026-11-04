// No enrolment or enforcement is performed by these helpers.
export function hqMfaOriginAllowed(request){
 const origin=request.headers.get('Origin');
 return origin==='https://hq.shiftsometimber.co.uk'||origin==='https://api.shiftsometimber.co.uk';
}
export async function claimHqMfaChallenge(DB,id,at){
 const result=await DB.prepare('UPDATE hq_mfa_challenges SET used_at=? WHERE id=? AND used_at IS NULL AND expires_at>?').bind(at,id,at).run();
 return Number(result.meta?.changes)===1;
}

