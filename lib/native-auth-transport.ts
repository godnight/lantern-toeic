import {parseProductIdentity,type ProductCredentials} from './product-identity';
import {monotonicNow,readSessionProof} from './session-proof';
import {normalizeMainlandPhone,parsePhonePublicReply,validPhoneVerification,type PhoneVerification,type PhonePurpose,type PhoneClientTransport} from './phone-auth-client';

export type NativeAuthAction='session'|'register'|'login'|'logout'|'phone-status'|'phone-challenge'|'phone-bind'|'phone-login';
export type NativeAuthBody=ProductCredentials|PhoneVerification|{purpose:PhonePurpose;phone:string};
export type NativeAuthReply={status:number;body:Record<string,unknown>;version?:2};
export type NativeAuthFailureCode='timeout'|'superseded'|'disposed'|'mutation-busy'|'protocol'|'bridge-failed';
export class NativeAuthFailure extends Error {
  constructor(readonly code:NativeAuthFailureCode){super('Native authentication '+code);this.name='NativeAuthFailure';}
}
export type NativeAuthWindow={location:{origin:string};top?:unknown;self?:unknown;
  LanternAuthHost?:{request:(serialized:string)=>unknown};__lanternAuthReceive?:(payload:unknown)=>void;
  crypto:{randomUUID:()=>string}};
export type NativeAuthClock={set:(callback:()=>void,ms:number)=>unknown;clear:(timer:unknown)=>void;now?:()=>number};
export type NativeAuthTransport={request:(action:NativeAuthAction,body?:NativeAuthBody,signal?:AbortSignal,version?:2)=>Promise<NativeAuthReply>;
  cancelAll:()=>void;dispose:()=>void};
const TRUSTED_ORIGIN='https://lantern.local',DEADLINE_MS=15000;
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const unavailable=(action:NativeAuthAction):NativeAuthReply=>({status:503,body:{code:'native-auth-unavailable',
  capabilities:action.startsWith('phone-')?{phoneLogin:false,phoneBinding:false}:{passwordLogin:false,phoneLogin:false,passwordRecovery:false,cloudSync:false}}});
const defaultClock:NativeAuthClock={set:(fn,ms)=>setTimeout(fn,ms),clear:timer=>clearTimeout(timer as ReturnType<typeof setTimeout>)};
type Pending={action:NativeAuthAction;version?:2;startedAt:number;resolve:(reply:NativeAuthReply)=>void;reject:(error:NativeAuthFailure)=>void;
  timer:unknown;removeAbort:()=>void};

function publicBody(value:unknown,proof=false):Record<string,unknown> {
  if(!object(value)||Object.keys(value).some(key=>![...['user','capabilities','code','error','ok'],...proof?['session']:[]].includes(key)))throw new NativeAuthFailure('protocol');
  const body:Record<string,unknown>={};
  if(value.user!==undefined){const identity=parseProductIdentity(value.user);if(!identity)throw new NativeAuthFailure('protocol');body.user=identity;}
  if(value.capabilities!==undefined){
    if(!object(value.capabilities)||Object.keys(value.capabilities).some(key=>!['passwordLogin','phoneLogin','passwordRecovery','cloudSync'].includes(key))||
      Object.values(value.capabilities).some(item=>typeof item!=='boolean'))throw new NativeAuthFailure('protocol');
    body.capabilities={...value.capabilities,cloudSync:false};
  }
  if(value.code!==undefined){if(typeof value.code!=='string'||!/^[a-z0-9-]{1,80}$/.test(value.code))throw new NativeAuthFailure('protocol');body.code=value.code;}
  if(value.error!==undefined){if(typeof value.error!=='string'||value.error.length>1000)throw new NativeAuthFailure('protocol');body.error=value.error;}
  if(value.ok!==undefined){if(typeof value.ok!=='boolean')throw new NativeAuthFailure('protocol');body.ok=value.ok;}
  if(proof&&value.session!==undefined)body.session=value.session;
  return body;
}

/** A fixed asynchronous native bridge, without cookies/tokens or persistent state. */
export function createNativeAuthTransport(target:NativeAuthWindow=window as unknown as NativeAuthWindow,
  clock:NativeAuthClock=defaultClock):NativeAuthTransport {
  const pending=new Map<string,Pending>();
  let disposed=false,mutationId:string|null=null;
  const trusted=()=>target.location.origin===TRUSTED_ORIGIN&&(target.top===undefined||target.top===target.self);
  const previous=target.__lanternAuthReceive;
  function finish(id:string,reply?:NativeAuthReply,error?:NativeAuthFailure){
    const item=pending.get(id);if(!item)return;
    pending.delete(id);clock.clear(item.timer);item.removeAbort();
    if(mutationId===id)mutationId=null;
    if(error)item.reject(error);else item.resolve(reply!);
  }
  const receive=(value:unknown)=>{
    if(disposed||!trusted()||!object(value)||typeof value.id!=='string'||!pending.has(value.id))return;
    try{
      const item=pending.get(value.id)!;
      if(Object.keys(value).sort().join(',')!==(item.version===2?'body,id,status,version':'body,id,status')||item.version===2&&value.version!==2||!Number.isInteger(value.status)||
        (value.status as number)<200||(value.status as number)>599)throw new NativeAuthFailure('protocol');
      const reply={status:value.status as number,body:value.body as Record<string,unknown>};
      const body=item.action.startsWith('phone-')?reply.body:publicBody(value.body,item.version===2);
      if(item.version===2&&reply.status!==200&&body.session!==undefined)throw new NativeAuthFailure('protocol');
      if(item.version===2&&reply.status===200){const proof=readSessionProof(value.body,'native',(clock.now??monotonicNow)()-item.startedAt);if(!proof)throw new NativeAuthFailure('protocol');body.session={validForMs:proof.validForMs};}
      finish(value.id,item.action.startsWith('phone-')?parsePhonePublicReply(item.action.slice(6) as 'status'|'challenge'|'bind'|'login',reply):{status:reply.status,body,...item.version===2?{version:2 as const}:{}});
    }catch{finish(value.id,undefined,new NativeAuthFailure('protocol'));}
  };
  if(trusted())target.__lanternAuthReceive=receive;
  function cancelAll(){for(const id of [...pending.keys()])finish(id,undefined,new NativeAuthFailure('superseded'));}
  return {
    request(action,body,signal,version){
      if(disposed)return Promise.reject(new NativeAuthFailure('disposed'));
      if(version!==undefined&&(version!==2||action!=='session'||body!==undefined))return Promise.reject(new NativeAuthFailure('protocol'));
      if(!['session','register','login','logout','phone-status','phone-challenge','phone-bind','phone-login'].includes(action))return Promise.reject(new NativeAuthFailure('protocol'));
      const mutation=action!=='session'&&action!=='phone-status';
      if(mutation&&mutationId!==null)return Promise.reject(new NativeAuthFailure('mutation-busy'));
      const password=action==='register'||action==='login',challenge=action==='phone-challenge',verification=action==='phone-bind'||action==='phone-login';
      if(password?(!body||Object.keys(body).sort().join(',')!=='password,username'||!('username' in body)||!('password' in body)||typeof body.username!=='string'||typeof body.password!=='string'):
        challenge?(!body||Object.keys(body).sort().join(',')!=='phone,purpose'||!('purpose' in body)||!['bind','login'].includes(body.purpose)||normalizeMainlandPhone(body.phone)!==body.phone):
        verification?!validPhoneVerification(body):body!==undefined)return Promise.reject(new NativeAuthFailure('protocol'));
      if(signal?.aborted)return Promise.reject(new NativeAuthFailure('superseded'));
      if(!trusted()||typeof target.LanternAuthHost?.request!=='function')return Promise.resolve(unavailable(action));
      if(typeof target.crypto?.randomUUID!=='function')return Promise.resolve(unavailable(action));
      return new Promise((resolve,reject)=>{
        const id=target.crypto.randomUUID();
        if(!/^[a-f0-9-]{36}$/i.test(id)||pending.has(id)){reject(new NativeAuthFailure('protocol'));return;}
        if(mutation)mutationId=id;
        const abort=()=>finish(id,undefined,new NativeAuthFailure('superseded'));
        const item:Pending={action,version,startedAt:version===2?(clock.now??monotonicNow)():0,resolve,reject,timer:undefined,removeAbort:()=>signal?.removeEventListener('abort',abort)};
        pending.set(id,item);signal?.addEventListener('abort',abort,{once:true});
        item.timer=clock.set(()=>finish(id,undefined,new NativeAuthFailure('timeout')),DEADLINE_MS);
        try{
          // The bridge returns no auth result synchronously. The complete public
          // callback must arrive before the15s deadline. No password is retained.
          let serialized=JSON.stringify({id,action,...version===2?{version:2}:{},...body?{body:{...body}}:{}});
          target.LanternAuthHost!.request(serialized);serialized='';
        }catch{finish(id,undefined,new NativeAuthFailure('bridge-failed'));}
      });
    },cancelAll,
    dispose(){if(disposed)return;disposed=true;for(const id of [...pending.keys()])finish(id,undefined,new NativeAuthFailure('disposed'));
      if(target.__lanternAuthReceive===receive){if(previous)target.__lanternAuthReceive=previous;else delete target.__lanternAuthReceive;}}
  };
}

declare global {
  interface Window {
    LanternAuthHost?:{request:(serialized:string)=>unknown};
    __lanternAuthReceive?:(payload:unknown)=>void;
  }
}

/** Uses the same transport/lock as password mutations; no second global receiver. */
export function nativePhoneClient(transport:NativeAuthTransport):PhoneClientTransport {
  return {request:(action,body,signal)=>transport.request(action==='status'?'phone-status':'phone-challenge',body,signal)};
}
