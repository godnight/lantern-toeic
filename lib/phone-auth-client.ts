import {parseProductCapabilities,productResponseIdentity} from './product-identity';
import {parseMainlandPhone} from './phone-number';
/** Public phone protocol only. No identity or ownership can be derived here. */
export type PhonePurpose='bind'|'login';
export type PhoneCapabilities=Readonly<{phoneLogin:boolean;phoneBinding:boolean}>;
export type PhoneChallenge=Readonly<{challengeId:string;expiresAt:string;resendAt:string;purpose:PhonePurpose;phone:string}>;
export type PhoneVerification=Readonly<{challengeId:string;phone:string;code:string}>;
export type PhoneOutcome=Readonly<{status:number;code:string;attemptsRemaining?:number;retryAt?:string}>;
export type PhoneReply=Readonly<{status:number;body:Record<string,unknown>}>;
export type PhoneClientTransport={request:(action:'status'|'challenge',body?:{purpose:PhonePurpose;phone:string},signal?:AbortSignal)=>Promise<PhoneReply>};
export class PhoneClientFailure extends Error {constructor(readonly code:'timeout'|'superseded'|'protocol'|'network'){super('Phone request '+code);this.name='PhoneClientFailure';}}
const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
export function normalizeMainlandPhone(value:string):string|null {
  const parsed=parseMainlandPhone(value);return parsed.ok?parsed.phone:null;
}
export function validPhoneVerification(value:unknown):value is PhoneVerification {
  return record(value)&&Object.keys(value).sort().join(',')==='challengeId,code,phone'&&
    typeof value.challengeId==='string'&&/^[A-Za-z0-9_-]{22,128}$/.test(value.challengeId)&&
    typeof value.phone==='string'&&normalizeMainlandPhone(value.phone)===value.phone&&typeof value.code==='string'&&/^[0-9]{6}$/.test(value.code);
}
export function phoneIso(value:unknown):value is string {
  return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)&&Number.isFinite(Date.parse(value));
}
export function parsePhoneCapabilities(value:unknown):PhoneCapabilities|null {
  if(!record(value)||Object.keys(value).join(',')!=='capabilities'||!record(value.capabilities))return null;
  const caps=value.capabilities;
  return Object.keys(caps).sort().join(',')==='phoneBinding,phoneLogin'&&typeof caps.phoneLogin==='boolean'&&typeof caps.phoneBinding==='boolean'
    ?Object.freeze({phoneLogin:caps.phoneLogin,phoneBinding:caps.phoneBinding}):null;
}
export function parsePhoneChallenge(value:unknown,purpose:PhonePurpose,phone:string,now=Date.now()):PhoneChallenge|null {
  if(!record(value)||Object.keys(value).sort().join(',')!=='challengeId,expiresAt,phone,purpose,resendAt'||
    typeof value.challengeId!=='string'||!/^[A-Za-z0-9_-]{32}$/.test(value.challengeId)||value.purpose!==purpose||value.phone!==phone||
    normalizeMainlandPhone(phone)!==phone||!phoneIso(value.expiresAt)||!phoneIso(value.resendAt))return null;
  const expiry=Date.parse(value.expiresAt),resend=Date.parse(value.resendAt);
  return expiry>now&&resend<=expiry?Object.freeze({challengeId:value.challengeId,purpose,phone,expiresAt:value.expiresAt,resendAt:value.resendAt}):null;
}
export function parsePhoneOutcome(reply:PhoneReply):PhoneOutcome {
  const body=reply.body;
  if(!record(body)||!Number.isInteger(reply.status)||reply.status<200||reply.status>599)throw new PhoneClientFailure('protocol');
  if(reply.status===200)return Object.freeze({status:200,code:'submitted'});
  if(Object.keys(body).some(key=>!['code','error','attemptsRemaining','retryAt','capabilities'].includes(key))||
    typeof body.code!=='string'||!/^[a-z][a-z0-9-]{0,79}$/.test(body.code)||
    body.error!==undefined&&(typeof body.error!=='string'||body.error.length>1000)||
    body.capabilities!==undefined&&(!record(body.capabilities)||Object.keys(body.capabilities).some(key=>!['passwordLogin','phoneLogin','phoneBinding','passwordRecovery','cloudSync'].includes(key))||Object.values(body.capabilities).some(value=>typeof value!=='boolean'))||
    body.attemptsRemaining!==undefined&&(!Number.isInteger(body.attemptsRemaining)||(body.attemptsRemaining as number)<0||(body.attemptsRemaining as number)>5)||
    body.retryAt!==undefined&&!phoneIso(body.retryAt))throw new PhoneClientFailure('protocol');
  return Object.freeze({status:reply.status,code:body.code,...body.attemptsRemaining!==undefined?{attemptsRemaining:body.attemptsRemaining as number}:{},...body.retryAt!==undefined?{retryAt:body.retryAt as string}:{}});
}
export function parsePhonePublicReply(action:'status'|'challenge'|'bind'|'login',reply:PhoneReply):PhoneReply {
  const body=reply.body;
  if(!record(body))throw new PhoneClientFailure('protocol');
  if(action==='status'&&reply.status===200){if(!parsePhoneCapabilities(body))throw new PhoneClientFailure('protocol');return reply;}
  if(action==='challenge'&&reply.status===202){
    if((body.purpose!=='bind'&&body.purpose!=='login')||typeof body.phone!=='string'||!parsePhoneChallenge(body,body.purpose,body.phone))throw new PhoneClientFailure('protocol');return reply;
  }
  if((action==='bind'||action==='login')&&reply.status===200){
    const keys=action==='bind'?'capabilities,ok,phone,user':'capabilities,user';
    if(Object.keys(body).sort().join(',')!==keys||!productResponseIdentity(body)||!parseProductCapabilities(body.capabilities)||
      action==='bind'&&(body.ok!==true||typeof body.phone!=='string'||normalizeMainlandPhone(body.phone)!==body.phone))throw new PhoneClientFailure('protocol');
    return reply;
  }
  if(reply.status<400)throw new PhoneClientFailure('protocol');
  parsePhoneOutcome(reply);return reply;
}
export function phoneOutcomeMessage(outcome:PhoneOutcome):string {
  if(outcome.status===200)return '提交已获确认；账号归属仍以独立会话核对为准。';
  if(outcome.status===503&&['auth-disabled','phone-auth-disabled','phone-provider-unavailable','phone-unavailable','native-auth-unavailable'].includes(outcome.code))return '手机号服务尚未配置，当前不能发送短信、绑定或登录。';
  if(outcome.status===429)return '尝试过于频繁，请等候后再试。';
  if(outcome.status===410)return '验证码已过期，请重新获取。';
  if(outcome.status===409)return '当前号码或账号状态存在冲突，请重新核对账号。';
  if(outcome.status===401||outcome.status===400||outcome.status===422)return '验证码未获确认，请检查号码和验证码。';
  return '请求结果无法确认；请重新核对状态，不会假定发送、绑定或登录成功。';
}

/**15s covers fetch and body decoding. Aborted/late readers cannot complete a newer operation. */
export function createWebPhoneTransport(fetcher:typeof fetch=fetch):PhoneClientTransport & {mutate:(purpose:PhonePurpose,body:PhoneVerification,signal?:AbortSignal)=>Promise<PhoneReply>} {
  async function send(action:'status'|'challenge'|'bind'|'login',body:unknown,signal?:AbortSignal):Promise<PhoneReply> {
    if(signal?.aborted)throw new PhoneClientFailure('superseded');
    const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined,active=true;
    let rejectDeadline!:(error:PhoneClientFailure)=>void;
    const deadline=new Promise<never>((_,reject)=>{rejectDeadline=reject;});
    const cancel=()=>{active=false;controller.abort();rejectDeadline(new PhoneClientFailure('superseded'));};
    signal?.addEventListener('abort',cancel,{once:true});
    timer=setTimeout(()=>{active=false;controller.abort();rejectDeadline(new PhoneClientFailure('timeout'));},15000);
    try{
      return await Promise.race([(async()=>{
        const response=await fetcher('/api/auth/phone/'+action,{method:action==='status'?'GET':'POST',credentials:'same-origin',cache:'no-store',
          headers:{Accept:'application/json',...action==='status'?{}:{'Content-Type':'application/json'}},...action==='status'?{}:{body:JSON.stringify(body)},signal:controller.signal});
        if(!active)throw new PhoneClientFailure('superseded');
        const value:unknown=await response.json();if(!active)throw new PhoneClientFailure('superseded');
        if(!record(value))throw new PhoneClientFailure('protocol');
        return parsePhonePublicReply(action,{status:response.status,body:value});
      })(),deadline]);
    }catch(error){if(error instanceof PhoneClientFailure)throw error;throw new PhoneClientFailure('network');}
    finally{active=false;if(timer!==undefined)clearTimeout(timer);signal?.removeEventListener('abort',cancel);controller.abort();body=undefined;}
  }
  return {request(action,body,signal){
    if(action==='status'){if(body!==undefined)return Promise.reject(new PhoneClientFailure('protocol'));}
    else if(action!=='challenge'||!body||Object.keys(body).sort().join(',')!=='phone,purpose'||!['bind','login'].includes(body.purpose)||normalizeMainlandPhone(body.phone)!==body.phone)return Promise.reject(new PhoneClientFailure('protocol'));
    return send(action,body,signal);
  },mutate(purpose,body,signal){if(!['bind','login'].includes(purpose)||!validPhoneVerification(body))return Promise.reject(new PhoneClientFailure('protocol'));return send(purpose,body,signal);}};
}
