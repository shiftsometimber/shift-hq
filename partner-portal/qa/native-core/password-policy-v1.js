// Owner-approved shared password rule, 24 October 2026. Login accepts existing
// credentials; this rule applies when creating or changing a password.
export const PASSWORD_POLICY_MESSAGE='Use at least 10 characters, including one capital letter and one special character.';
export function passwordMeetsPolicy(value){
 return typeof value==='string'&&value.length>=10&&/[A-Z]/.test(value)&&/[\p{P}\p{S}]/u.test(value);
}

