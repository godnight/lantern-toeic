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
// It never deletes source chunks and never retries unknown outcomes itself.
export function createCapturedVocabularyMarkPump({storage,owner,client,target}){
 if(!target||typeof target.addEventListener!=='function'||typeof target.removeEventListener!=='function')throw Error('capture unavailable');
 const session=client?.session;
 if(!session||session.owner!==owner||session.signal.aborted)throw Error('session revoked');
 let stopped=false,dirty=false,pending=null;
 const current=()=>!stopped&&client.session===session&&!session.signal.aborted;
 const wake=()=>{
  if(!current())return Promise.reject(Error('session revoked'));
  dirty=true;if(pending)return pending;
  let completed=false;pending=(async()=>{
   while(dirty){
    dirty=false;await scanCapturedVocabularyMarks(storage,owner,client);
    if(!current())throw Error('session revoked');
    await client.run(session);
   }
   completed=true;
  })().finally(()=>{pending=null;if(completed&&dirty&&current())void wake().catch(()=>{});});
  return pending;
 };
 const key=vocabularyKey(owner);
 const changed=event=>{if(event.type==='online'||event.type==='storage'&&(!event.key||event.key.startsWith(key))||event.type==='lantern-vocabulary-changed'&&event.detail===key)void wake().catch(()=>{});};
 target.addEventListener('online',changed);target.addEventListener('storage',changed);target.addEventListener('lantern-vocabulary-changed',changed);
 return Object.freeze({wake,stop(){if(stopped)return;stopped=true;target.removeEventListener('online',changed);target.removeEventListener('storage',changed);target.removeEventListener('lantern-vocabulary-changed',changed);}});
}
