const enc=new TextEncoder();
const b64=b=>Buffer.from(b).toString('base64url');
const bytes=s=>new Uint8Array(Buffer.from(s,'base64url'));
const join=(...a)=>{const b=new Uint8Array(a.reduce((n,x)=>n+x.length,0));let p=0;for(const x of a){b.set(x,p);p+=x.length;}return b;};
const hash=async b=>new Uint8Array(await crypto.subtle.digest('SHA-256',b));
function cbor(value){
 const head=(major,n)=>n<24?new Uint8Array([major*32+n]):n<256?new Uint8Array([major*32+24,n]):new Uint8Array([major*32+25,n>>8,n&255]);
 if(Number.isInteger(value))return value>=0?head(0,value):head(1,-1-value);
 if(typeof value==='string'){const b=enc.encode(value);return join(head(3,b.length),b);}
 if(value instanceof Uint8Array)return join(head(2,value.length),value);
 if(value instanceof Map)return join(head(5,value.size),...Array.from(value).flatMap(([k,v])=>[cbor(k),cbor(v)]));
 throw Error('Unsupported fixture CBOR');
}
const der=raw=>{const parts=[raw.slice(0,32),raw.slice(32)].map(part=>{let i=0;while(i<31&&part[i]===0)i++;let n=part.slice(i);if(n[0]&128)n=join(new Uint8Array([0]),n);return join(new Uint8Array([2,n.length]),n);});const body=join(...parts);return join(new Uint8Array([48,body.length]),body);};
export async function authenticator({rpId='partner.shiftsometimber.co.uk'}={}){
 const keys=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']),jwk=await crypto.subtle.exportKey('jwk',keys.publicKey),credential=crypto.getRandomValues(new Uint8Array(32));let counter=0;
 const auth=async(registration)=>{const count=new Uint8Array(4);new DataView(count.buffer).setUint32(0,counter);return join(await hash(enc.encode(rpId)),new Uint8Array([registration?0x45:0x05]),count);};
 return {credentialId:b64(credential),publicKey:jwk,
  async register(challenge,origin='https://partner.shiftsometimber.co.uk'){
   const cose=new Map([[1,2],[3,-7],[-1,1],[-2,bytes(jwk.x)],[-3,bytes(jwk.y)]]),data=join(await auth(true),new Uint8Array(16),new Uint8Array([0,credential.length]),credential,cbor(cose));
   return {credentialId:b64(credential),clientDataJSON:b64(enc.encode(JSON.stringify({type:'webauthn.create',challenge,origin,crossOrigin:false}))),attestationObject:b64(cbor(new Map([['fmt','none'],['attStmt',new Map()],['authData',data]])))};
  },
  async sign(challenge,origin='https://partner.shiftsometimber.co.uk'){
   counter++;const client=enc.encode(JSON.stringify({type:'webauthn.get',challenge,origin,crossOrigin:false})),authData=await auth(false),raw=await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},keys.privateKey,join(authData,await hash(client)));
   return {credentialId:b64(credential),clientDataJSON:b64(client),authenticatorData:b64(authData),signature:b64(der(new Uint8Array(raw))),userHandle:null};
  }
 };
}
