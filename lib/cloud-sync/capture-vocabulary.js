// Experimental scanner, not connected to the application. Marked source
// chunks remain untouched; each event is enqueued transactionally by the
// supplied synthetic client. The caller must provide a trusted lifecycle.
import {parseVocabularyBackup,vocabularyKey} from '../vocabulary-model';
import {VOCABULARY_MARK_CAPTURE_KEY_PREFIX} from './vocabulary-capture';

export async function scanCapturedVocabularyMarks(storage,owner,client){
 if(!storage||typeof storage.key!=='function'||typeof storage.getItem!=='function'||
    !Number.isSafeInteger(storage.length)||storage.length<0||storage.length>100000||
    typeof owner!=='string'||!/^usr_[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(owner)||
    !client||typeof client.vocabulary!=='function')throw Error('capture unavailable');
 const captured=client.session;
 const active=()=>!!captured&&client.session===captured&&captured.owner===owner&&!captured.signal.aborted;
 if(!active())throw Error('session revoked');
 const prefix=vocabularyKey(owner)+VOCABULARY_MARK_CAPTURE_KEY_PREFIX,entries=[];
 const count=storage.length;
 for(let i=0;i<count;i++){
  const name=storage.key(i);if(typeof name!=='string'||!name.startsWith(prefix))continue;
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(name.slice(prefix.length)))throw Error('invalid captured key');
  const raw=storage.getItem(name);if(typeof raw!=='string'||raw.length>16384)throw Error('invalid captured chunk');
  const backup=parseVocabularyBackup(JSON.parse(raw));
  if(backup.events.length!==1||backup.events[0].type!=='mark')throw Error('invalid captured event');
  entries.push({name,raw,event:backup.events[0]});
 }
 for(const entry of entries){
  if(!active()||storage.getItem(entry.name)!==entry.raw)throw Error('capture changed or session revoked');
  await client.vocabulary(entry.event,captured);
  if(!active()||storage.getItem(entry.name)!==entry.raw)throw Error('capture changed or session revoked');
 }
 return entries.length;
}

// Explicitly installed by the synthetic harness only. A first scan and
// subsequent change/online events re-find saved chunks after interruption.
// It never deletes source chunks. Only explicitly classified transient bridge
// failures are retried: the client must reuse its persisted event IDs.
export function createCapturedVocabularyMarkPump({storage,owner,client,target,captureStudy,captureVocabulary,setTimer=setTimeout,clearTimer=clearTimeout,retryBaseMs=1000,retryMaxMs=60000}){
 if(!target||typeof target.addEventListener!=='function'||typeof target.removeEventListener!=='function')throw Error('capture unavailable');
 if((captureStudy!==undefined&&typeof captureStudy!=='function')||(captureVocabulary!==undefined&&typeof captureVocabulary!=='function')||typeof setTimer!=='function'||typeof clearTimer!=='function'||!Number.isSafeInteger(retryBaseMs)||retryBaseMs<1||!Number.isSafeInteger(retryMaxMs)||retryMaxMs<retryBaseMs||retryMaxMs>3600000)throw Error('capture unavailable');
 const session=client?.session;
 if(!session||session.owner!==owner||session.signal.aborted)throw Error('session revoked');
 let stopped=false,dirty=false,pending=null,retryTimer=null,retries=0;
 const current=()=>!stopped&&client.session===session&&!session.signal.aborted;
 const clearRetry=()=>{if(retryTimer!==null){clearTimer(retryTimer);retryTimer=null;}};
 const wake=()=>{
  if(!current())return Promise.reject(Error('session revoked'));
  clearRetry();dirty=true;if(pending)return pending;
  let completed=false,rerunDirty=false;pending=Promise.resolve().then(async()=>{
   try{
    while(dirty){
     dirty=false;if(captureVocabulary)await captureVocabulary(session);else await scanCapturedVocabularyMarks(storage,owner,client);
     if(!current())throw Error('session revoked');
     if(captureStudy)await captureStudy(session);
     if(!current())throw Error('session revoked');
     await client.run(session);
    }
    retries=0;completed=true;
   }catch(error){
    if(current()&&error?.code==='NATIVE_TRANSIENT'){
     const delay=Math.min(retryMaxMs,retryBaseMs*2**Math.min(retries++,20));
     retryTimer=setTimer(()=>{retryTimer=null;if(current())void wake().catch(()=>{});},delay);
    }
    // A change received during a conflicted run deserves one fresh pass;
    // without a new change a persistent conflict never schedules itself.
    if(current()&&error?.code==='NATIVE_EVENT_CONFLICT'&&dirty)rerunDirty=true;
    throw error;
   }
  }).finally(()=>{pending=null;if((completed&&dirty||rerunDirty)&&current())void wake().catch(()=>{});});
  return pending;
 };
 const key=vocabularyKey(owner),studyKey='lantern-v1-'+owner;
 const changed=event=>{if(event.type==='online'||event.type==='focus'||event.type==='storage'&&(!event.key||event.key.startsWith(key)||event.key.startsWith(studyKey+':op:'))||event.type==='lantern-vocabulary-changed'&&event.detail===key||event.type==='lantern-study-changed'&&event.detail===studyKey)void wake().catch(()=>{});};
 const stop=()=>{if(stopped)return;stopped=true;clearRetry();target.removeEventListener('online',changed);target.removeEventListener('focus',changed);target.removeEventListener('storage',changed);target.removeEventListener('lantern-vocabulary-changed',changed);target.removeEventListener('lantern-study-changed',changed);session.signal.removeEventListener('abort',stop);};
 target.addEventListener('online',changed);target.addEventListener('focus',changed);target.addEventListener('storage',changed);target.addEventListener('lantern-vocabulary-changed',changed);target.addEventListener('lantern-study-changed',changed);session.signal.addEventListener('abort',stop,{once:true});
 // Scan durable work on activation even if there is no new network event.
 void Promise.resolve().then(()=>{if(current()&&!pending)return wake();}).catch(()=>{});
 return Object.freeze({wake,stop});
}
