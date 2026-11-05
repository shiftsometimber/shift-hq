// Temporary password-only Rx sign-in authorised for these existing accounts.
// Roles, passwords, sessions and professional permissions remain authoritative.
export const PASSWORD_SIGNIN_LAST_DAY='2026-11-12T23:59:59.000Z';
const accounts=[
 {id:152,email:'shiftsometimber@gmail.com',role:'owner'},
 {id:171,email:'matt@shiftsometimber.co.uk',role:'owner'},
 {id:172,email:'sstrx@shiftsometimber.co.uk',role:'operations'}
];
export function passwordSignInAllowed(env,user,now=Date.now()){
 if(env.SSTRX_PASSWORD_SIGNIN_ENABLED!=='true'||user?.status!=='active'||user?.mfaEnabled!==false)return false;
 const until=Date.parse(env.SSTRX_PASSWORD_SIGNIN_UNTIL||'');
 if(!Number.isFinite(until)||until<=now||until>Date.parse(PASSWORD_SIGNIN_LAST_DAY))return false;
 return accounts.some(a=>a.id===user.id&&a.email===user.email&&a.role===user.role);
}
