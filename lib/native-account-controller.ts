import {parseProductCapabilities,parseProductIdentity,productResponseIdentity,type ProductCapabilities,type ProductCredentials,type ProductIdentity} from './product-identity';
import {CLOSED_NATIVE_PROVIDERS,NativeAuthFailure,parseNativeProviders,type NativeAuthProviders,type NativeAuthReply,type NativeAuthTransport} from './native-auth-transport';
import {parsePhoneOutcome,type PhoneOutcome,type PhonePurpose,type PhoneVerification} from './phone-auth-client';
import {readSessionProof,SessionDeadline,sessionClock,publicLocalAccess,type AccountAccess,type SessionClock} from './session-proof';

export type NativeAccountState=Readonly<
  {status:'checking';message:string}|{status:'blocked';message:string}|
  {status:'ready';user:ProductIdentity|null;capabilities:ProductCapabilities;unavailable:boolean;message:string;access:AccountAccess}>;
export const INITIAL_NATIVE_ACCOUNT_STATE:NativeAccountState=Object.freeze({status:'checking',message:'正在核对账号会话。'});
const guestCapabilities:ProductCapabilities=Object.freeze({passwordLogin:true,phoneLogin:false,passwordRecovery:false,cloudSync:false});
// A slow tail gives the single native operation slot time to recover without a hot loop.
// Once exhausted, a later network-online event may start a new bounded round.
const LOCAL_RETRY_DELAYS=[250,500,1000,2000,4000,8000,60000,60000,60000,60000] as const;
type Listener=(state:NativeAccountState,synchronous:boolean)=>void;
export type SyncTransitionGuard={prepare:()=>Promise<void>;complete:()=>Promise<void>};
type NetworkEvents={addEventListener:(type:'online',listener:()=>void)=>void;removeEventListener:(type:'online',listener:()=>void)=>void};

function verifiedSession(reply:NativeAuthReply,elapsed:number):{user:ProductIdentity|null;capabilities:ProductCapabilities;unavailable:boolean;validForMs?:number}|null {
  if(reply.status===200){const proof=reply.version===2?readSessionProof(reply.body,'native',elapsed):null;
    return proof?{...proof,unavailable:false}:null;}
  if(reply.status===401&&reply.body.code==='unauthenticated')return {user:null,capabilities:guestCapabilities,unavailable:false};
  if(reply.status===503&&['native-auth-unavailable','auth-disabled'].includes(String(reply.body.code))){
    const capabilities=parseProductCapabilities(reply.body.capabilities);
    if(capabilities?.passwordLogin===false)return {user:null,capabilities,unavailable:true};
  }
  return null;
}

/** Identity gate. Mutation bodies are never consulted when choosing a partition. */
export class NativeAccountController {
  private generation=0;
  private alive=true;
  private mutationPending=false;
  private everAuthenticated=false;
  private mutationAttempted=false;
  private held=false;
  private deadline:SessionDeadline|null=null;
  private localAbort:AbortController|null=null;
  private localAccess:AccountAccess|null=null;
  private localProbePending=false;
  private localProbeAgain=false;
  private localFallbackGeneration:number|null=null;
  private localFallbackOwner:string|null=null;
  private localFallbackParked=false;
  private localRetryTimer:unknown=undefined;
  private localRetryWake:((ready:boolean)=>void)|null=null;
  private networkEvents:NetworkEvents|null=null;
  private providers:NativeAuthProviders=CLOSED_NATIVE_PROVIDERS;
  private huaweiGeneration:number|null=null;
  private huaweiBackground=false;
  private foregroundWait:(()=>void)|null=null;
  private initialProbe:Promise<void>|null=null;
  private syncTransitionGuard:SyncTransitionGuard|null=null;
  private listeners=new Set<Listener>();
  private state:NativeAccountState=INITIAL_NATIVE_ACCOUNT_STATE;
  constructor(private transport:NativeAuthTransport,private clock:SessionClock=sessionClock,private options:{localOffline?:boolean;networkEvents?:NetworkEvents}={}){
    if(options.localOffline===true){
      this.networkEvents=options.networkEvents??(typeof window!=='undefined'?window:null);
      this.networkEvents?.addEventListener('online',this.onOnline);
    }
  }
  getSnapshot=()=>this.state;
  subscribe=(listener:Listener)=>{this.listeners.add(listener);return()=>{this.listeners.delete(listener);};};
  setSyncTransitionGuard(guard:SyncTransitionGuard):()=>void{
    if(this.syncTransitionGuard)throw Error('sync transition guard already installed');
    this.syncTransitionGuard=guard;return()=>{if(this.syncTransitionGuard===guard)this.syncTransitionGuard=null;};
  }
  private async prepareSyncTransition(generation:number):Promise<boolean>{
    if(this.syncTransitionGuard)await this.syncTransitionGuard.prepare();
    return this.current(generation);
  }
  private async completeSyncTransition(generation:number):Promise<void>{
    if(!this.current(generation))return;
    try{await this.syncTransitionGuard?.complete();}catch{/* Sync remains frozen; account outcome is independent. */}
  }
  private update(state:NativeAccountState,synchronous=false){
    if(!this.alive)return;this.state=Object.freeze(state);for(const listener of this.listeners)listener(this.state,synchronous);
  }
  private begin(message:string,synchronous:boolean){
    const generation=++this.generation;
    this.cancelLocalRetry();this.localFallbackGeneration=null;this.localFallbackOwner=null;this.localFallbackParked=false;
    this.huaweiGeneration=null;this.huaweiBackground=false;this.foregroundWait?.();this.foregroundWait=null;
    this.deadline?.close();this.deadline=null;
    this.localAbort?.abort();this.localAbort=null;this.localAccess=null;
    this.transport.cancelAll();this.mutationPending=false;
    // A React subscriber flushes this notification before any bridge call starts.
    this.update({status:'checking',message},synchronous);return generation;
  }
  private current(generation:number){return this.alive&&generation===this.generation;}
  private cancelLocalRetry(){
    if(this.localRetryTimer!==undefined)this.clock.clear(this.localRetryTimer);
    this.localRetryTimer=undefined;const wake=this.localRetryWake;this.localRetryWake=null;wake?.(false);
  }
  private waitLocalRetry(generation:number,delay:number):Promise<boolean>{
    if(!this.current(generation))return Promise.resolve(false);
    return new Promise(resolve=>{
      this.localRetryWake=resolve;
      this.localRetryTimer=this.clock.set(()=>{this.localRetryTimer=undefined;this.localRetryWake=null;resolve(this.current(generation));},delay);
    });
  }
  private cancelLocalFallbackForMutation():boolean{
    if(this.options.localOffline!==true||this.localFallbackGeneration!==this.generation)return false;
    this.held=true;this.begin('账号操作尚未确认，学习分区已暂停。',true);
    this.update({status:'blocked',message:'账号操作尚未确认，请重新核对账号。'},true);return true;
  }
  private onOnline=()=>{
    if(this.alive&&this.localFallbackParked&&this.localFallbackGeneration===this.generation&&this.localFallbackOwner){
      const generation=this.generation,owner=this.localFallbackOwner;this.localFallbackParked=false;
      this.initialProbe=this.startWithLocal(generation,owner);return;
    }
    if(!this.alive||this.state.status!=='ready'||!this.state.user||this.state.access.scope!=='local-study-only')return;
    if(this.localProbePending){this.localProbeAgain=true;return;}
    this.initialProbe=this.verifyLocal(this.generation,this.state.user.id);
  };
  private async verifyLocal(generation:number,owner:string):Promise<void>{
    if(this.localProbePending){this.localProbeAgain=true;return;}
    this.localProbePending=true;
    try{await this.probe(generation,'',undefined,undefined,owner);}
    finally{
      this.localProbePending=false;
      const again=this.localProbeAgain;this.localProbeAgain=false;
      if(again&&this.alive&&this.state.status==='ready'&&this.state.user&&this.state.access.scope==='local-study-only')this.onOnline();
    }
  }
  private async awaitForeground(generation:number){
    while(this.current(generation)&&this.huaweiGeneration===generation&&this.huaweiBackground)
      await new Promise<void>(resolve=>{this.foregroundWait=resolve;});
    return this.current(generation);
  }
  async getProviders():Promise<NativeAuthProviders>{
    // The native host has one process-wide operation slot. Discovery must not
    // race the startup proof and turn a configured provider into a busy failure.
    if(this.initialProbe&&(this.state.status==='checking'||this.options.localOffline===true))await this.initialProbe;
    if(!this.alive||this.state.status!=='ready'||this.state.unavailable)return CLOSED_NATIVE_PROVIDERS;
    try{const reply=await this.transport.request('providers');
      if(this.alive)this.providers=reply.status===200?parseNativeProviders(reply.body)??CLOSED_NATIVE_PROVIDERS:CLOSED_NATIVE_PROVIDERS;
    }catch{this.providers=CLOSED_NATIVE_PROVIDERS;}
    return this.alive?this.providers:CLOSED_NATIVE_PROVIDERS;
  }
  private async probe(generation:number,warning='',expectedOwner?:string,expectedOwnerMessage='华为账号绑定后的身份发生变化，学习分区保持暂停。请重新核对账号。',localOwner?:string){
    try{
      if(this.huaweiGeneration===generation&&!await this.awaitForeground(generation))return;
      const started=this.clock.now();const reply=await this.transport.request('session',undefined,undefined,2);
      if(!this.current(generation)||this.huaweiGeneration===generation&&!await this.awaitForeground(generation))return;
      const proof=verifiedSession(reply,this.clock.now()-started);
      if(!proof||proof.unavailable&&(this.everAuthenticated||this.mutationAttempted)){
        if(localOwner&&this.localAccess?.canAccess())return;
        if(this.huaweiGeneration===generation)this.held=true;
        this.update({status:'blocked',message:'当前账号状态无法确认，学习分区保持暂停。请重新核对账号。'});return;
      }
      if(localOwner&&!proof.user&&this.localAccess?.canAccess())return;
      if(localOwner&&proof.user&&proof.user.id!==localOwner){
        this.localAbort?.abort();this.localAbort=null;this.localAccess=null;this.held=true;
        this.update({status:'blocked',message:'当前账号身份发生变化，请重新核对账号。'},true);return;
      }
      if(expectedOwner!==undefined&&proof.user?.id!==expectedOwner){
        this.held=true;
        this.update({status:'blocked',message:expectedOwnerMessage},true);return;
      }
      if(proof.user)this.everAuthenticated=true;
      this.localAbort?.abort();this.localAbort=null;this.localAccess=null;
      const deadline=proof.user?new SessionDeadline(proof.validForMs!,()=>{
        if(!this.current(generation))return;
        const owner=proof.user!.id,next=this.begin('会话已到期，学习分区已锁定。',true);
        this.update({status:'blocked',message:'会话有效期已结束，原数据保留。请联网重新核对账号。'},true);
        // A local lease is not a refresh or server proof. Reacquire it through
        // the native host and permit only the same previously verified owner.
        if(this.options.localOffline===true){
          this.localFallbackGeneration=next;
          this.localFallbackOwner=owner;this.localFallbackParked=false;
          this.initialProbe=this.startWithLocal(next,owner);
        }
      },this.clock):null;
      this.deadline=deadline;
      const access:AccountAccess=deadline?{user:proof.user!,owner:proof.user!.id,epoch:generation,scope:'remote',canAccess:deadline.canAccess,assertAccess:deadline.assertAccess,sessionSignal:deadline.signal}:publicLocalAccess(null,generation);
      if(deadline&&!deadline.canAccess()){deadline.assertAccess();return;}
      this.update({status:'ready',user:proof.user,capabilities:proof.capabilities,unavailable:proof.unavailable,access,message:warning==='已退出本机。'&&proof.user?'原退出结果未确认；当前显示的是重新核对的账号。':warning});
    }catch{
      if(localOwner&&this.current(generation)&&this.localAccess?.canAccess())return;
      if(this.current(generation)){if(this.huaweiGeneration===generation)this.held=true;this.update({status:'blocked',message:'当前账号状态未获确认，学习分区保持暂停。请重新核对账号。'});}
    }
  }
  private async startWithLocal(generation:number,expectedLocalOwner?:string):Promise<void>{
    let localOwner:string|undefined;
    if(this.options.localOffline===true&&this.transport.isLocalActive){
      const delays=expectedLocalOwner?LOCAL_RETRY_DELAYS:[];
      for(let attempt=0;attempt<=delays.length;attempt++){
       let retry=false;
       try{
        const reply=await this.transport.request('local-session');
        if(!this.current(generation))return;
        retry=reply.status===503&&reply.body.code==='local-unavailable';
        const user=reply.status===200?parseProductIdentity(reply.body.user):null,local=reply.body.local;
        if(user&&(!expectedLocalOwner||user.id===expectedLocalOwner)&&local&&typeof local==='object'&&!Array.isArray(local)&&Object.keys(local).sort().join(',')==='generation,scope'){
          const proof=local as {scope?:unknown;generation?:unknown};
          if(proof.scope==='local-study-only'&&typeof proof.generation==='number'&&Number.isSafeInteger(proof.generation)&&proof.generation>0){
            const localGeneration=proof.generation,abort=new AbortController();
            const canAccess=()=>this.current(generation)&&!abort.signal.aborted&&this.transport.isLocalActive?.(user.id,localGeneration)===true;
            const assertAccess=()=>{const ok=canAccess();if(!ok)abort.abort();return ok;};
            if(canAccess()){
              this.localAbort=abort;localOwner=user.id;
              if(this.localFallbackGeneration===generation){this.localFallbackGeneration=null;this.localFallbackOwner=null;this.localFallbackParked=false;}
              this.localAccess={user,owner:user.id,epoch:generation,scope:'local-study-only',canAccess,assertAccess,sessionSignal:abort.signal};
              this.update({status:'ready',user,capabilities:guestCapabilities,unavailable:false,message:'',access:this.localAccess});
            }
          }
        }
       }catch(error){retry=error instanceof NativeAuthFailure&&error.code==='timeout';}
       if(!retry)break;
       if(attempt>=delays.length){if(this.current(generation)&&this.localFallbackGeneration===generation)this.localFallbackParked=true;break;}
       if(!await this.waitLocalRetry(generation,delays[attempt]))break;
      }
    }
    if(this.current(generation)){
      if(expectedLocalOwner&&!localOwner&&!this.localFallbackParked&&this.localFallbackGeneration===generation){this.localFallbackGeneration=null;this.localFallbackOwner=null;}
      // At expiry, an absent or different cached owner must never cause an
      // automatic account switch or fall through to another remote identity.
      if(expectedLocalOwner&&!localOwner)return;
      if(localOwner)await this.verifyLocal(generation,localOwner);
      else await this.probe(generation);
    }
  }
  start(){if(this.alive){const generation=this.begin('正在核对账号会话。',false);this.initialProbe=this.options.localOffline===true?this.startWithLocal(generation):this.probe(generation);}}
  // Focus/native-resume and a retry click may arrive together. Keep the pending
  // probe/mutation; suspend and unknown results enter blocked before retrying.
  recheck(){if(!this.alive||this.state.status==='checking')return;const warning=this.held?'当前身份已重新核对；这不确认原账号操作结果。':'';this.held=false;const generation=this.begin('正在重新核对账号，旧学习分区已暂停。',true);void (this.options.localOffline===true&&!warning?this.startWithLocal(generation):this.probe(generation,warning));}
  resume(){if(this.huaweiGeneration===this.generation){this.huaweiBackground=false;this.foregroundWait?.();this.foregroundWait=null;return;}if(!this.held)this.recheck();}
  hold(message='账号操作结果未确认，分区已锁定。请显式重新核对账号。'){if(!this.alive)return;this.held=true;this.begin(message,true);this.update({status:'blocked',message},true);}
  suspend(synchronous=true,preserveHuawei=false){if(!this.alive)return;
    if(preserveHuawei&&this.huaweiGeneration===this.generation){this.huaweiBackground=true;return;}
    this.begin('页面已离开，账号身份需要重新核对。',synchronous);
    this.update({status:'blocked',message:this.held?'账号操作结果未确认，分区已锁定。请显式重新核对账号。':'账号身份待重新核对，学习分区已暂停。'});}
  async mutate(action:'register'|'login'|'logout',credentials?:ProductCredentials):Promise<boolean> {
    if(this.cancelLocalFallbackForMutation())return false;
    if(this.state.status==='ready'&&this.state.user&&!this.state.access.assertAccess())return false;
    if(!this.alive||this.mutationPending||this.state.status!=='ready'||this.state.unavailable||
      !this.state.capabilities.passwordLogin||action==='logout'&&!this.state.user)return false;
    this.mutationAttempted=true;
    const generation=this.begin('账号操作进行中，旧学习分区已暂停。',true);this.mutationPending=true;
    try{
      if(this.syncTransitionGuard&&!await this.prepareSyncTransition(generation))return false;
      const pending=this.transport.request(action,credentials);credentials=undefined;
      const reply=await pending;
      if(!this.current(generation))return false;
      if(reply.status>=500){this.held=true;this.update({status:'blocked',message:'账号操作结果尚未确认，本机分区已锁定。请显式联网重新核对；不会自动重发。'},true);return false;}
      const warning=reply.status===200?(action==='logout'?'已退出本机。':''):reply.status===429?'尝试过于频繁，请稍后再试。':
        action==='logout'?'退出未获确认；以下账号状态来自独立会话核对。':
        '账号操作未获确认，请检查用户名和密码；以下状态来自独立会话核对。';
      // Even an error or a forged-looking mutation user must not choose owner.
      // This new session request is the sole positive identity evidence.
      this.update({status:'checking',message:'正在独立核对服务器会话，尚未切换学习分区。'});
      await this.probe(generation,warning);
      const confirmed=this.state as NativeAccountState;
      // Navigation receives an outcome only after the independent session proof.
      // A rejected mutation with a still-valid old session is not a successful login.
      if(reply.status!==200||!this.current(generation)||confirmed.status!=='ready'||confirmed.unavailable)return false;
      const ok=action==='logout'?confirmed.user===null:!!confirmed.user&&confirmed.access.owner===confirmed.user.id&&confirmed.access.assertAccess();
      if(ok&&this.syncTransitionGuard)await this.completeSyncTransition(generation);
      return ok&&this.current(generation);
    }catch{
      if(this.current(generation)){this.held=true;this.update({status:'blocked',message:'账号操作结果未知，本机分区已锁定；不代表凭据已清理或服务器已撤销。请显式重新核对账号。'});}
      return false;
    }finally{if(this.current(generation))this.mutationPending=false;}
  }
  async mutateHuawei(purpose:'login'|'bind'):Promise<boolean>{
    if(this.cancelLocalFallbackForMutation())return false;
    if(!this.alive||!['login','bind'].includes(purpose)||this.mutationPending||this.state.status!=='ready'||this.state.unavailable||
      !(purpose==='login'?this.providers.huaweiLogin:this.providers.huaweiBinding)||purpose==='bind'&&!this.state.user)return false;
    if(this.state.user&&!this.state.access.assertAccess())return false;
    const previousUser=this.state.user?.id??null;
    this.mutationAttempted=true;
    const generation=this.begin('华为账号授权进行中，旧学习分区已暂停。',true);
    this.huaweiGeneration=generation;this.mutationPending=true;
    try{
      if(this.syncTransitionGuard&&!await this.prepareSyncTransition(generation))return false;
      const reply=await this.transport.request(purpose==='login'?'huawei-login':'huawei-bind');
      if(!this.current(generation))return false;
      if(reply.status>=500){this.held=true;this.update({status:'blocked',message:'华为账号操作结果尚未确认，学习分区已锁定。请显式重新核对账号；不会自动重发。'},true);return false;}
      if(!await this.awaitForeground(generation))return false;
      const warning=reply.status===200?(purpose==='bind'?'华为账号已绑定，学习记录仍属于当前账号。':''):
        reply.body.code==='huawei-cancelled'?'华为账号授权已取消。':
        reply.body.code==='huawei-binding-conflict'?'该华为账号已绑定其他微光账号，请使用原账号登录。':
        '华为账号操作未获确认，请稍后重试。';
      this.update({status:'checking',message:'正在独立核对服务器会话，尚未切换学习分区。'});
      await this.probe(generation,warning,purpose==='bind'?previousUser!:undefined);
      if(!this.current(generation))return false;
      const confirmed=this.state as NativeAccountState;
      if(confirmed.status!=='ready'||confirmed.unavailable)return false;
      if(purpose==='bind'&&confirmed.user?.id!==previousUser){
        this.held=true;
        this.deadline?.close();this.deadline=null;
        this.update({status:'blocked',message:'华为账号绑定后的身份发生变化，学习分区保持暂停。请重新核对账号。'},true);return false;
      }
      const ok=reply.status===200&&!!confirmed.user&&confirmed.access.owner===confirmed.user.id&&confirmed.access.assertAccess();
      if(ok&&this.syncTransitionGuard)await this.completeSyncTransition(generation);
      return ok&&this.current(generation);
    }catch{
      if(this.current(generation)){this.held=true;this.update({status:'blocked',message:'华为账号操作结果尚未确认，学习分区已锁定。请显式重新核对账号；不会自动重发。'},true);}
      return false;
    }finally{if(this.current(generation)){this.mutationPending=false;this.huaweiGeneration=null;this.huaweiBackground=false;this.foregroundWait?.();this.foregroundWait=null;}}
  }
  async mutatePhone(purpose:PhonePurpose,body:PhoneVerification):Promise<PhoneOutcome|undefined> {
    if(this.cancelLocalFallbackForMutation())return;
    if(this.state.status==='ready'&&this.state.user&&!this.state.access.assertAccess())return;
    if(!this.alive||this.mutationPending||!['bind','login'].includes(purpose)||this.state.status!=='ready'||this.state.unavailable||purpose==='bind'&&!this.state.user)return;
    const previousUser=this.state.user?.id??null;
    this.mutationAttempted=true;
    this.held=true;
    const generation=this.begin('手机号操作进行中，旧学习分区已暂停。',true);this.mutationPending=true;
    try{
      if(this.syncTransitionGuard&&!await this.prepareSyncTransition(generation))return;
      const pending=this.transport.request(purpose==='bind'?'phone-bind':'phone-login',body);body=undefined as unknown as PhoneVerification;
      const reply=await pending;if(!this.current(generation))return;
      const outcome=parsePhoneOutcome(reply);
      if(outcome.code==='auth-state-unknown'||outcome.status>=500&&!['auth-disabled','phone-auth-disabled','phone-provider-unavailable','phone-unavailable','native-auth-unavailable'].includes(outcome.code)){
        this.held=true;
        this.update({status:'blocked',message:'手机号操作结果未知，学习分区保持暂停。请重新核对账号。'});return;
      }
      // Preserve the hold until the independent session proof completes.
      this.held=true;
      this.update({status:'checking',message:'正在独立核对服务器会话，尚未切换学习分区。'});
      await this.probe(generation,outcome.status===200?'':'手机号操作未获确认；以下账号状态来自独立会话核对。',purpose==='bind'?previousUser!:undefined,'手机号操作后的账号身份未获预期确认，学习分区保持暂停。请重新核对账号。');
      if(!this.current(generation))return;
      const confirmed=this.state as NativeAccountState;
      if(confirmed.status!=='ready')return;
      if(purpose==='bind'&&confirmed.user?.id!==previousUser||outcome.status===200&&purpose==='login'&&!confirmed.user){
        this.deadline?.close();this.deadline=null;
        this.update({status:'blocked',message:'手机号操作后的账号身份未获预期确认，学习分区保持暂停。请重新核对账号。'});return;
      }
      this.held=false;
      if(outcome.status===200&&this.syncTransitionGuard)await this.completeSyncTransition(generation);
      return this.current(generation)?outcome:undefined;
    }catch{
      if(this.current(generation)){this.held=true;this.update({status:'blocked',message:'手机号操作结果未知，不能假定已发送、绑定或登录。请重新核对账号。'});}
    }finally{if(this.current(generation))this.mutationPending=false;}
  }
  dispose(){if(!this.alive)return;this.alive=false;++this.generation;this.cancelLocalRetry();this.localFallbackGeneration=null;this.localFallbackOwner=null;this.localFallbackParked=false;this.huaweiGeneration=null;this.foregroundWait?.();this.foregroundWait=null;this.deadline?.close();this.deadline=null;this.localAbort?.abort();this.localAbort=null;this.localAccess=null;this.networkEvents?.removeEventListener('online',this.onOnline);this.networkEvents=null;this.transport.dispose();this.listeners.clear();}
}
