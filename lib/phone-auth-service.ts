import {phoneFlowAction} from './phone-flow-service';
import {authConfiguration,authJson,readProductIdentity,sameOriginMutation,createProductSessionMaterial,productSessionResponse,productSessionTokenHash,type AuthEnvironment} from './auth-service';
import {parseMainlandPhone} from './phone-number';
import {readBoundedRequestBody,RequestBodyTooLargeError} from './request-body';
import {createPhoneVerificationBoundary,type PhoneVerificationProvider} from './phone-verification';
import {createPhoneD1Store} from './phone-d1-store';

const unavailable=(passwordLogin=false)=>authJson({code:'phone-unavailable',error:'手机号验证服务尚未配置或暂不可用；原账号和记录保留',capabilities:{passwordLogin,phoneLogin:false,passwordRecovery:false}},503);
type Options={provider:PhoneVerificationProvider|null;providerId:string;audience:string};

/** Trusted server injection only. Product routes always use the closed factory. */
export function createPhoneAuthService(options:Readonly<Options>){
 return async function action(request:Request,purpose:'bind'|'login',env:AuthEnvironment):Promise<Response>{
  const config=authConfiguration(env);
  // Missing provider returns before body, DB reads, rate buckets or writes. No
  // request field, URL parameter or environment fake flag can turn it on.
  if(!config||!options.provider)return unavailable(Boolean(config));
  if(!sameOriginMutation(request,config.origin))return authJson({code:'invalid-origin',error:'请求来源不匹配'},403);
  try{
   if(request.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json')return authJson({code:'invalid-phone-request'},400);
   let input:unknown;
   try{input=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await readBoundedRequestBody(request,8192)));}
   catch(error){return authJson({code:error instanceof RequestBodyTooLargeError?'phone-request-too-large':'invalid-phone-request'},error instanceof RequestBodyTooLargeError?413:400);}
   if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).sort().join(',')!=='opaqueCredential,phone')return authJson({code:'invalid-phone-request'},400);
   const body=input as {phone:unknown;opaqueCredential:unknown},parsed=parseMainlandPhone(body.phone);
   if(!parsed.ok)return authJson({code:'invalid-phone-request'},400);
   const bindingUser=purpose==='bind'?await readProductIdentity(request.headers,env):null;
   if(purpose==='bind'&&!bindingUser)return authJson({code:'unauthenticated'},401);
   const session=createProductSessionMaterial(request.headers);
   const store=createPhoneD1Store({db:config.db,purpose,audience:options.audience,providerId:options.providerId,phone:parsed.phone,bindingUser,bindingTokenHash:productSessionTokenHash(request.headers),session});
   const boundary=createPhoneVerificationBoundary({provider:options.provider,providerId:options.providerId,audience:options.audience,store});
   const result=await boundary.verifyAndCommit(purpose==='bind'?{purpose,phone:parsed.phone,bindingUserId:bindingUser!.id}:{purpose,phone:parsed.phone},body.opaqueCredential);
   if(!result.ok){
    const status=result.error==='unavailable'?503:result.error==='unauthorized'?401:result.error==='binding-conflict'||result.error==='replayed'?409:400;
    return authJson({code:'phone-'+result.error},status);
   }
   const user=store.committedIdentity();
   if(!user||user.id!==result.userId)return unavailable(true);
   return purpose==='login'?productSessionResponse(user,session.token):authJson({ok:true,user,phone:result.phone,capabilities:{passwordLogin:true,phoneLogin:false,passwordRecovery:false}});
  }catch{return unavailable(true);}
 };
}

export async function phoneAuthAction(request:Request,purpose:'bind'|'login',env:AuthEnvironment):Promise<Response>{
 return phoneFlowAction(request,purpose,env);
}
