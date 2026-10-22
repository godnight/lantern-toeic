import {parseProductCapabilities,productResponseIdentity,type ProductCapabilities,type ProductCredentials,type ProductIdentity} from './product-identity';
import type {NativeAuthReply,NativeAuthTransport} from './native-auth-transport';
import {parsePhoneOutcome,type PhoneOutcome,type PhonePurpose,type PhoneVerification} from './phone-auth-client';

export type NativeAccountState=Readonly<
  {status:'checking';message:string}|{status:'blocked';message:string}|
  {status:'ready';user:ProductIdentity|null;capabilities:ProductCapabilities;unavailable:boolean;message:string}>;
export const INITIAL_NATIVE_ACCOUNT_STATE:NativeAccountState=Object.freeze({status:'checking',message:'正在核对原生账号会话。'});
const guestCapabilities:ProductCapabilities=Object.freeze({passwordLogin:true,phoneLogin:false,passwordRecovery:false,cloudSync:false});
type Listener=(state:NativeAccountState,synchronous:boolean)=>void;

function verifiedSession(reply:NativeAuthReply):{user:ProductIdentity|null;capabilities:ProductCapabilities;unavailable:boolean}|null {
  if(reply.status===200){const user=productResponseIdentity(reply.body),capabilities=parseProductCapabilities(reply.body.capabilities);
    return user&&capabilities?.passwordLogin===true?{user,capabilities,unavailable:false}:null;}
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
  private listeners=new Set<Listener>();
  private state:NativeAccountState=INITIAL_NATIVE_ACCOUNT_STATE;
  constructor(private transport:NativeAuthTransport){}
  getSnapshot=()=>this.state;
  subscribe=(listener:Listener)=>{this.listeners.add(listener);return()=>{this.listeners.delete(listener);};};
  private update(state:NativeAccountState,synchronous=false){
    if(!this.alive)return;this.state=Object.freeze(state);for(const listener of this.listeners)listener(this.state,synchronous);
  }
  private begin(message:string,synchronous:boolean){
    const generation=++this.generation;
    this.transport.cancelAll();this.mutationPending=false;
    // A React subscriber flushes this notification before any bridge call starts.
    this.update({status:'checking',message},synchronous);return generation;
  }
  private current(generation:number){return this.alive&&generation===this.generation;}
  private async probe(generation:number,warning=''){
    try{
      const reply=await this.transport.request('session');
      if(!this.current(generation))return;
      const proof=verifiedSession(reply);
      if(!proof||proof.unavailable&&(this.everAuthenticated||this.mutationAttempted)){
        this.update({status:'blocked',message:'当前账号状态无法确认，学习分区保持暂停。请重新核对账号。'});return;
      }
      if(proof.user)this.everAuthenticated=true;
      this.update({status:'ready',...proof,message:warning});
    }catch{
      if(this.current(generation))this.update({status:'blocked',message:'当前账号状态未获确认，学习分区保持暂停。请重新核对账号。'});
    }
  }
  start(){if(this.alive){const generation=this.begin('正在核对原生账号会话。',false);void this.probe(generation);}}
  recheck(){if(!this.alive)return;const generation=this.begin('正在重新核对账号，旧学习分区已暂停。',true);void this.probe(generation);}
  suspend(synchronous=true){if(!this.alive)return;this.begin('页面已离开，账号身份需要重新核对。',synchronous);
    this.update({status:'blocked',message:'账号身份待重新核对，学习分区已暂停。'});}
  async mutate(action:'register'|'login'|'logout',credentials?:ProductCredentials):Promise<void> {
    if(!this.alive||this.mutationPending||this.state.status!=='ready'||this.state.unavailable||
      !this.state.capabilities.passwordLogin||action==='logout'&&!this.state.user)return;
    this.mutationAttempted=true;
    const generation=this.begin('账号操作进行中，旧学习分区已暂停。',true);this.mutationPending=true;
    try{
      const pending=this.transport.request(action,credentials);credentials=undefined;
      const reply=await pending;
      if(!this.current(generation))return;
      const warning=reply.status===200?'':reply.status===429?'尝试过于频繁，请稍后再试。':
        action==='logout'?'退出未获确认；以下账号状态来自独立会话核对。':
        '账号操作未获确认，请检查用户名和密码；以下状态来自独立会话核对。';
      // Even an error or a forged-looking mutation user must not choose owner.
      // This new session request is the sole positive identity evidence.
      this.update({status:'checking',message:'正在独立核对服务器会话，尚未切换学习分区。'});
      await this.probe(generation,warning);
    }catch{
      if(this.current(generation))this.update({status:'blocked',message:'账号操作结果未知，不能假定已切换或退出。请重新核对账号。'});
    }finally{if(this.current(generation))this.mutationPending=false;}
  }
  async mutatePhone(purpose:PhonePurpose,body:PhoneVerification):Promise<PhoneOutcome|undefined> {
    if(!this.alive||this.mutationPending||!['bind','login'].includes(purpose)||this.state.status!=='ready'||this.state.unavailable||purpose==='bind'&&!this.state.user)return;
    const previousUser=this.state.user?.id??null;
    this.mutationAttempted=true;
    const generation=this.begin('手机号操作进行中，旧学习分区已暂停。',true);this.mutationPending=true;
    try{
      const pending=this.transport.request(purpose==='bind'?'phone-bind':'phone-login',body);body=undefined as unknown as PhoneVerification;
      const reply=await pending;if(!this.current(generation))return;
      const outcome=parsePhoneOutcome(reply);
      if(outcome.code==='auth-state-unknown'||outcome.status>=500&&!['auth-disabled','phone-auth-disabled','phone-provider-unavailable','phone-unavailable','native-auth-unavailable'].includes(outcome.code)){
        this.update({status:'blocked',message:'手机号操作结果未知，学习分区保持暂停。请重新核对账号。'});return;
      }
      this.update({status:'checking',message:'正在独立核对服务器会话，尚未切换学习分区。'});
      await this.probe(generation,outcome.status===200?'':'手机号操作未获确认；以下账号状态来自独立会话核对。');
      if(!this.current(generation))return;
      const confirmed=this.state as NativeAccountState;
      if(confirmed.status!=='ready')return;
      if(purpose==='bind'&&confirmed.user?.id!==previousUser||outcome.status===200&&purpose==='login'&&!confirmed.user){
        this.update({status:'blocked',message:'手机号操作后的账号身份未获预期确认，学习分区保持暂停。请重新核对账号。'});return;
      }
      return outcome;
    }catch{
      if(this.current(generation))this.update({status:'blocked',message:'手机号操作结果未知，不能假定已发送、绑定或登录。请重新核对账号。'});
    }finally{if(this.current(generation))this.mutationPending=false;}
  }
  dispose(){if(!this.alive)return;this.alive=false;++this.generation;this.transport.dispose();this.listeners.clear();}
}
