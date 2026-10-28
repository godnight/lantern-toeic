import {parseProductIdentity,parseProductCapabilities,type ProductIdentity,type ProductCapabilities} from './product-identity';

export const SESSION_PROOF_HEADER='X-Lantern-Session-Proof';
export const MAX_SESSION_BUDGET_MS=43200000;
export const monotonicNow=()=>typeof performance==='undefined'?NaN:performance.now();
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const keys=(v:Record<string,unknown>,expected:string)=>Object.keys(v).sort().join(',')===expected;
export function validSessionBudget(value:unknown):value is number{return typeof value==='number'&&Number.isSafeInteger(value)&&value>0&&value<=MAX_SESSION_BUDGET_MS;}
export function readSessionProof(value:unknown,kind:'http'|'native',elapsedMs:number):{user:ProductIdentity;capabilities:ProductCapabilities;validForMs:number}|null {
  if(!object(value)||!keys(value,'capabilities,session,user')||!object(value.session)||!Number.isFinite(elapsedMs)||elapsedMs<0)return null;
  if(!object(value.capabilities)||Object.keys(value.capabilities).some(key=>!['passwordLogin','phoneLogin','passwordRecovery','cloudSync'].includes(key))||Object.values(value.capabilities).some(item=>typeof item!=='boolean'))return null;
  const user=parseProductIdentity(value.user),capabilities=parseProductCapabilities(value.capabilities),session=value.session;
  if(!user||!capabilities?.passwordLogin)return null;
  if(kind==='http'?!keys(session,'remainingMs,version')||session.version!==2:!keys(session,'validForMs'))return null;
  const raw=kind==='http'?session.remainingMs:session.validForMs;
  if(!validSessionBudget(raw))return null;
  const validForMs=Math.floor(raw-elapsedMs);
  return validSessionBudget(validForMs)?{user,capabilities,validForMs}:null;
}
export type SessionClock={now:()=>number;set:(fn:()=>void,ms:number)=>unknown;clear:(timer:unknown)=>void};
export const sessionClock:SessionClock={now:monotonicNow,set:(fn,ms)=>{const timer=setTimeout(fn,ms);(timer as unknown as {unref?:()=>void}).unref?.();return timer;},clear:timer=>clearTimeout(timer as ReturnType<typeof setTimeout>)};
export type AccountAccess={owner:string|null;epoch:number;canAccess:()=>boolean;assertAccess:()=>boolean};
/** A single proof's in-memory budget. Closing an old proof never affects a new one. */
export class SessionDeadline {
  private end:number;private last:number;private closed=false;private notified=false;private timer:unknown;
  constructor(ms:number,private expired:()=>void,private clock:SessionClock=sessionClock){
    this.last=clock.now();this.end=this.last+ms;
    if(!validSessionBudget(ms)||!Number.isFinite(this.last)||this.last<0)this.closed=true;
    else this.timer=clock.set(this.wake,ms);
  }
  private wake=()=>{if(!this.canAccess())this.assertAccess();else this.timer=this.clock.set(this.wake,Math.max(1,Math.ceil(this.end-this.clock.now())));};
  canAccess=()=>{const now=this.clock.now();const ok=!this.closed&&Number.isFinite(now)&&now>=this.last&&now<this.end;if(ok)this.last=now;else this.close();return ok;};
  assertAccess=()=>{if(this.canAccess())return true;this.close();if(!this.notified){this.notified=true;this.expired();}return false;};
  close(){this.closed=true;if(this.timer!==undefined)this.clock.clear(this.timer);this.timer=undefined;}
}
export function publicLocalAccess(owner:string|null,epoch=0):AccountAccess{return {owner,epoch,canAccess:()=>true,assertAccess:()=>true};}
