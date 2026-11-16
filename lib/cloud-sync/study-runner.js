// Browser adaptation of the frozen synthetic runner; not connected to product.
'use strict';
// SYNTHETIC PROTOTYPE ONLY. This file does not open product storage, acquire
// credentials, make network requests or wire itself to the application.
import * as native from '../native-study-m2a';
import * as sessions from './study-sessions.js';
import * as model from '../study-model';
import { FENCE, matches } from './idb-fence.js';
const randomUUID = () => crypto.randomUUID();
const STATE = 'syntheticNativeStudyState', SESSION = 'syntheticNativeStudySession';
const ownerPattern = /^usr_[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const copy = x => JSON.parse(JSON.stringify(x));
const stable = x => Array.isArray(x) ? `[${x.map(stable).join(',')}]` : x && typeof x === 'object' ? `{${Object.keys(x).sort().map(k => `${JSON.stringify(k)}:${stable(x[k])}`).join(',')}}` : JSON.stringify(x);
const invalid = () => Error('synthetic study state unavailable or account changed');
function fresh(owner) { return { version: 1, stateVersion: 0, owner, data: copy(model.EMPTY_DATA), download: { checkpoint: null, continuation: null, pendingProfiles: [] }, pendingOperations: [], blockedOperations: [], deferredOperations: [], eventLinks: [], uploadAcks: [] }; }
function activateTx(db, owner, ticket) {
    return new Promise((resolve, reject) => {
        let tx;
        try {
            tx = db.transaction([STATE, SESSION, FENCE], 'readwrite');
        }
        catch (e) {
            reject(e);
            return;
        }
        let generation, reason;
        const meta = tx.objectStore(SESSION), records = tx.objectStore(STATE), g = meta.get('active'), s = records.get(owner), f = tx.objectStore(FENCE).get('active');
        let ready = 0;
        function begin() {
            if (++ready !== 3)
                return;
            try {
                if (!matches(f.result, ticket) || ticket.owner !== owner)
                    throw invalid();
                const old = g.result?.generation ?? 0;
                if (!Number.isSafeInteger(old) || old < 0 || old >= Number.MAX_SAFE_INTEGER)
                    throw invalid();
                generation = old + 1;
                meta.put({ id: 'active', owner, generation });
                if (!s.result)
                    records.put(fresh(owner));
            }
            catch (e) {
                reason = e;
                tx.abort();
            }
        }
        g.onsuccess = begin;
        s.onsuccess = begin;
        f.onsuccess = begin;
        tx.oncomplete = () => resolve(generation);
        tx.onabort = () => reject(reason ?? tx.error ?? invalid());
        tx.onerror = () => { };
    });
}
function txn(db, lease, generation, ticket, apply) {
    return new Promise((resolve, reject) => {
        if (!lease || lease.signal.aborted || !lease.isCurrent()) {
            reject(invalid());
            return;
        }
        let tx;
        try {
            tx = db.transaction([STATE, SESSION, FENCE], 'readwrite');
        }
        catch (e) {
            reject(e);
            return;
        }
        let result, reason, ready = 0;
        const meta = tx.objectStore(SESSION).get('active'), store = tx.objectStore(STATE), get = store.get(lease.owner), f = tx.objectStore(FENCE).get('active');
        const cancel = () => { reason = invalid(); try {
            tx.abort();
        }
        catch { } };
        lease.signal.addEventListener('abort', cancel, { once: true });
        function process() {
            if (++ready !== 3)
                return;
            try {
                if (lease.signal.aborted || !lease.isCurrent() || !matches(f.result, ticket) || ticket.owner !== lease.owner || meta.result?.owner !== lease.owner || meta.result?.generation !== generation || !get.result || get.result.owner !== lease.owner || get.result.version !== 1 || !Number.isSafeInteger(get.result.stateVersion) || get.result.stateVersion < 0 || get.result.stateVersion >= Number.MAX_SAFE_INTEGER || !Array.isArray(get.result.pendingOperations) || (get.result.blockedOperations !== undefined && !Array.isArray(get.result.blockedOperations)) || (get.result.deferredOperations !== undefined && !Array.isArray(get.result.deferredOperations)) || (get.result.eventLinks !== undefined && !Array.isArray(get.result.eventLinks)) || !Array.isArray(get.result.uploadAcks))
                    throw invalid();
                const blocked=get.result.blockedOperations??[], blockedIds=new Set(), pendingIds=new Set(get.result.pendingOperations.map(x=>x?.id));
                if(blocked.length>5000)throw invalid();
                for(const item of blocked){
                    if(!item||item.owner!==lease.owner||item.type!=='attempt'||item.firstAttemptId!==undefined||!uuid.test(item.id)||blockedIds.has(item.id)||pendingIds.has(item.id))throw invalid();
                    blockedIds.add(item.id);
                }
                const deferred=get.result.deferredOperations??[], deferredIds=new Set(), ackIds=new Set(get.result.uploadAcks.map(x=>x?.id));
                if(deferred.length>5000)throw invalid();
                for(const item of deferred){
                    if(!item||item.owner!==lease.owner||item.type!=='attempt'||!uuid.test(item.id)||!uuid.test(item.firstAttemptId)||item.data?.mode!=='review'||!uuid.test(item.data?.id)||item.firstAttemptId===item.data.id||typeof item.data.qid!=='string'||deferredIds.has(item.id)||blockedIds.has(item.id)||pendingIds.has(item.id)||ackIds.has(item.id))throw invalid();
                    deferredIds.add(item.id);
                }
                const links=get.result.eventLinks??[], eventKeys=new Set(), operationIds=new Set();
                const attempts=new Set(get.result.data?.attempts?.map(x=>x.id)??[]),checkins=new Set(get.result.data?.checkins?.map(x=>x.id)??[]);
                for(const link of links){
                    const keys=Object.keys(link??{}).sort().join(','), expected=link?.firstAttemptId===undefined?'eventId,operationId,owner,type':'eventId,firstAttemptId,operationId,owner,type';
                    const eventKey=link?.type+':'+link?.eventId;
                    if(!link||keys!==expected||link.owner!==lease.owner||!['attempt','checkin'].includes(link.type)||!uuid.test(link.eventId)||!uuid.test(link.operationId)||
                      (link.firstAttemptId!==undefined&&(link.type!=='attempt'||!uuid.test(link.firstAttemptId)))||eventKeys.has(eventKey)||operationIds.has(link.operationId)||
                      !(link.type==='attempt'?attempts:checkins).has(link.eventId))throw invalid();
                    eventKeys.add(eventKey);operationIds.add(link.operationId);
                }
                const value = apply(copy(get.result));
                if (!value || !value.state || value.state.owner !== lease.owner)
                    throw invalid();
                if (value.write)
                    store.put(value.state);
                result = copy(value.state);
            }
            catch (e) {
                reason = e;
                try {
                    tx.abort();
                }
                catch { }
            }
        }
        meta.onsuccess = process;
        get.onsuccess = process;
        f.onsuccess = process;
        const cleanup = () => lease.signal.removeEventListener('abort', cancel);
        tx.oncomplete = () => { cleanup(); result ? resolve(result) : reject(invalid()); };
        tx.onabort = () => { cleanup(); reject(reason ?? tx.error ?? invalid()); };
        tx.onerror = () => { };
    });
}
function waitRequest(start, lease, timeoutMs) {
    if (lease.signal.aborted)
        return Promise.reject(invalid());
    return new Promise((resolve, reject) => {
        let settled = false;
        const done = (fn, value) => { if (settled)
            return; settled = true; clearTimeout(timer); lease.signal.removeEventListener('abort', cancel); fn(value); };
        const request = new AbortController();
        const cancel = () => { request.abort(); done(reject, invalid()); }, timer = setTimeout(() => { request.abort(); const error=Error('synthetic transport timeout');error.code='NATIVE_TRANSIENT';done(reject,error); }, timeoutMs);
        lease.signal.addEventListener('abort', cancel, { once: true });
        Promise.resolve().then(() => start(request.signal)).then(x => done(resolve, x), e => done(reject, e));
    });
}
function createStudyRunner({ db, transport, timeoutMs = 10000, maxPending = 5000 } = {}) {
    if (!db || !transport || typeof transport.upload !== 'function' || typeof transport.pull !== 'function' || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000 || !Number.isInteger(maxPending) || maxPending < 1 || maxPending > 5000)
        throw Error('invalid synthetic configuration');
    let lease, generation, ticket, serial = 0, running = false;
    function cancel() { serial++; if (lease)
        sessions.revokeNativeCandidateSession(lease); lease = undefined; generation = undefined; ticket = undefined; }
    async function activate(owner, sharedTicket) {
        if (!ownerPattern.test(owner))
            throw Error('invalid synthetic owner');
        cancel();
        const serialTicket = serial;
        const next = sessions.createNativeCandidateSession(owner);
        try {
            const gen = await activateTx(db, owner, sharedTicket);
            if (serialTicket !== serial) {
                sessions.revokeNativeCandidateSession(next);
                throw invalid();
            }
            lease = next;
            generation = gen;
            ticket = sharedTicket;
            return owner;
        }
        catch (e) {
            if (!next.signal.aborted)
                sessions.revokeNativeCandidateSession(next);
            throw e;
        }
    }
    function current() { if (!lease || lease.signal.aborted || !lease.isCurrent())
        throw invalid(); return { lease, generation, ticket }; }
    async function read() { const c = current(); return txn(db, c.lease, c.generation, c.ticket, state => ({ state, write: false })); }
    async function record(kind, data, operationId = randomUUID(), firstAttemptId) {
        const c = current(), frozen = copy(data);
        if (!['attempt', 'checkin'].includes(kind) || !uuid.test(operationId) || !uuid.test(frozen?.id) || (kind === 'attempt' && (typeof frozen.qid !== 'string' || frozen.qid.length > 100)) || (kind === 'checkin' && !model.validStudyDate(frozen.date)))
            throw Error('invalid synthetic event');
        const field=kind==='attempt'?'attempts':'checkins';
        // Read under the owner fence, then derive the canonical old operation
        // ID before hashing. The final transaction rejects any intervening
        // change; no digest or acknowledgement is inferred from an event ID.
        const before=await txn(db,c.lease,c.generation,c.ticket,state=>({state,write:false}));
        const links=before.eventLinks??[], link=links.find(x=>x.type===kind&&x.eventId===frozen.id);
        const candidates=[...before.pendingOperations,...(before.blockedOperations??[]),...(before.deferredOperations??[])].filter(x=>x.type===kind&&x.data?.id===frozen.id);
        if(candidates.length>1)throw Error('event conflict');
        const candidate=candidates[0], canonicalId=link?.operationId??candidate?.id??operationId;
        const operation={id:canonicalId,owner:c.lease.owner,type:kind,data:frozen,...(firstAttemptId===undefined?{}:{firstAttemptId})};
        const prepared=await native.prepareNativeUpload(operation,c.lease);
        return txn(db,c.lease,c.generation,c.ticket,state=>{
            if(state.stateVersion!==before.stateVersion){const error=Error('study state changed');error.code='NATIVE_TRANSIENT';throw error;}
            // A byte change without the corresponding version bump indicates
            // corruption, not ordinary concurrency; do not retry it as such.
            if(JSON.stringify(state)!==JSON.stringify(before))throw invalid();
            const matchingEvents=state.data[field].filter(x=>x.id===frozen.id);
            if(matchingEvents.length>1)throw Error('event conflict');
            const event=matchingEvents[0], rows=[...state.pendingOperations,...(state.blockedOperations??[]),...(state.deferredOperations??[])];
            const existing=rows.filter(x=>x.id===canonicalId), acks=state.uploadAcks.filter(x=>x.id===canonicalId);
            if(existing.length>1||acks.length>1||existing.length===1&&stable(existing[0])!==stable(operation)||
                event&&stable(event)!==stable(frozen)||link&&link.firstAttemptId!==firstAttemptId||candidate&&candidate.id!==canonicalId||
                acks.length===1&&acks[0].fingerprint!==prepared.fingerprint)throw Error('event conflict');
            if((event||link||existing.length||acks.length)){
                if(!event||(!existing.length&&!acks.length))throw Error('event mapping unavailable');
                if(!link){
                    // Legacy acknowledgements with no surviving operation can
                    // only be recovered when this exact operation ID and
                    // fingerprint were supplied; changed IDs are not guessed.
                    const otherLink=(state.eventLinks??[]).find(x=>x.operationId===canonicalId);
                    if(otherLink)throw Error('event conflict');
                    const newLink={owner:c.lease.owner,type:kind,eventId:frozen.id,operationId:canonicalId,...(firstAttemptId===undefined?{}:{firstAttemptId})};
                    return {state:{...state,stateVersion:state.stateVersion+1,eventLinks:[...(state.eventLinks??[]),newLink]},write:true};
                }
                return {state,write:false};
            }
            if((state.eventLinks??[]).some(x=>x.operationId===canonicalId))throw Error('event conflict');
            if(state.pendingOperations.length>=maxPending){const error=Error('synthetic queue full');error.code='NATIVE_QUEUE_FULL';throw error;}
            const newLink={owner:c.lease.owner,type:kind,eventId:frozen.id,operationId:canonicalId,...(firstAttemptId===undefined?{}:{firstAttemptId})};
            return {state:{...state,stateVersion:state.stateVersion+1,data:{...state.data,[field]:[...state.data[field],frozen]},pendingOperations:[...state.pendingOperations,operation],eventLinks:[...(state.eventLinks??[]),newLink]},write:true};
        });
    }
    async function prioritizeRoot(data,operationId,firstAttemptId) {
        const c=current(),frozen=copy(data),root={id:operationId,owner:c.lease.owner,type:'attempt',data:frozen,firstAttemptId};
        if(!uuid.test(operationId)||!uuid.test(frozen?.id)||frozen.mode!=='first'||firstAttemptId!==frozen.id)throw Error('invalid root');
        await native.prepareNativeUpload(root,c.lease);let replaced=false;
        await txn(db,c.lease,c.generation,c.ticket,state=>{
            const deferred=state.deferredOperations??[],blocked=state.blockedOperations??[],event=state.data.attempts.find(x=>x.id===frozen.id);
            const priorRows=state.pendingOperations.filter(x=>x.id===operationId),acks=state.uploadAcks.filter(x=>x.id===operationId);
            if(priorRows.length>1||blocked.some(x=>x.id===operationId)||deferred.some(x=>x.id===operationId))throw Error('event conflict');
            const prior=priorRows[0];
            if(prior){if(stable(prior)!==stable(root)||!event||stable(event)!==stable(frozen))throw Error('event conflict');replaced=true;return {state,write:false};}
            if(acks.length||event||deferred.length>=5000||state.pendingOperations.length<maxPending)return {state,write:false};
            if((state.eventLinks??[]).some(x=>x.operationId===operationId||x.type==='attempt'&&x.eventId===frozen.id))throw Error('event conflict');
            const i=state.pendingOperations.findIndex(x=>x.type==='attempt'&&x.data?.mode==='review'&&x.data.qid===frozen.qid&&x.firstAttemptId===frozen.id&&!state.uploadAcks.some(a=>a.id===x.id));
            if(i<0)return {state,write:false};
            const review=state.pendingOperations[i],reviewFact=state.data.attempts.find(x=>x.id===review.data.id);
            if(!reviewFact||stable(reviewFact)!==stable(review.data)||deferred.some(x=>x.id===review.id))throw Error('event conflict');
            state.pendingOperations.splice(i,1,root);state.deferredOperations=[...deferred,review];state.data.attempts.push(frozen);
            state.eventLinks=[...(state.eventLinks??[]),{owner:c.lease.owner,type:'attempt',eventId:frozen.id,operationId,firstAttemptId}];state.stateVersion++;replaced=true;
            return {state,write:true};
        });
        return replaced;
    }
    function promote(state,op) {
        if(op.type!=='attempt'||!op.firstAttemptId)return state;
        const pending=[...state.pendingOperations],deferred=state.deferredOperations??[],rest=[];
        for(const item of deferred){
            if(pending.length<maxPending&&item.firstAttemptId===op.firstAttemptId&&item.data.qid===op.data.qid)pending.push(item);
            else rest.push(item);
        }
        return {...state,pendingOperations:pending,deferredOperations:rest};
    }
    async function run() {
        if (running)
            throw Error('synthetic runner busy');
        running = true;
        try {
            const c = current();
            let state = await txn(db, c.lease, c.generation, c.ticket, s => ({ state: s, write: false }));
            // Journal keys are not ordered. Send known roots before their
            // dependent reviews; unresolved roots stay pending on server 409.
            const ordered = [...state.pendingOperations].sort((a,b) => Number(!(a.type==='attempt'&&a.firstAttemptId===a.data?.id)) - Number(!(b.type==='attempt'&&b.firstAttemptId===b.data?.id))),orderedIds=new Set(ordered.map(x=>x.id));
            const includePromoted=()=>{for(const next of state.pendingOperations)if(!orderedIds.has(next.id)){orderedIds.add(next.id);ordered.push(next);}};
            let conflicts=(state.blockedOperations??[]).length>0;
            for (const op of ordered) {
                const sent = await native.prepareNativeUpload(op, c.lease), matches = state.uploadAcks.filter(x => x.id === op.id);
                if (matches.length > 1 || (matches.length === 1 && matches[0].fingerprint !== sent.fingerprint))
                    throw Error('synthetic acknowledgement conflict');
                if (matches.length === 1) {
                    const captured=state;
                    state=await txn(db,c.lease,c.generation,c.ticket,s=>{
                        if(s.stateVersion!==captured.stateVersion||JSON.stringify(s)!==JSON.stringify(captured))throw invalid();
                        const field=op.type==='attempt'?'attempts':'checkins', event=s.data[field].find(x=>x.id===op.data?.id);
                        const acks=s.uploadAcks.filter(x=>x.id===op.id);
                        if(!event||stable(event)!==stable(op.data)||acks.length!==1||acks[0].fingerprint!==sent.fingerprint)throw invalid();
                        return {state:promote({...s,stateVersion:s.stateVersion+1,pendingOperations:s.pendingOperations.filter(x=>x.id!==op.id)},op),write:true};
                    });
                    includePromoted();
                    continue;
                }
                const captured = state;
                let response;
                try { response = await waitRequest(signal => transport.upload({ owner: c.lease.owner, wire: copy(sent.wire), signal }), c.lease, timeoutMs); }
                catch (error) {
                    if (error?.code !== 'NATIVE_EVENT_CONFLICT') throw error;
                    conflicts=true;
                    // An old unanchored attempt cannot become uploadable by
                    // retrying unchanged. Retain its complete bytes and fact
                    // separately so it cannot consume all active queue slots.
                    if(op.type==='attempt'&&op.firstAttemptId===undefined){
                        const captured=state;
                        state=await txn(db,c.lease,c.generation,c.ticket,s=>{
                            if(s.stateVersion!==captured.stateVersion||JSON.stringify(s)!==JSON.stringify(captured))throw invalid();
                            const blocked=s.blockedOperations??[], event=s.data.attempts.find(x=>x.id===op.data?.id);
                            if(blocked.length>=5000)return {state:s,write:false};
                            if(!event||stable(event)!==stable(op.data)||blocked.some(x=>x.id===op.id))throw invalid();
                            return {state:{...s,stateVersion:s.stateVersion+1,pendingOperations:s.pendingOperations.filter(x=>x.id!==op.id),blockedOperations:[...blocked,op]},write:true};
                        });
                    }
                    continue;
                }
                const next = await native.acknowledgeNativeUpload(captured, sent, response, c.lease);
                state = await txn(db, c.lease, c.generation, c.ticket, s => {
                    if (s.stateVersion !== captured.stateVersion || JSON.stringify(s) !== JSON.stringify(captured)) throw invalid();
                    const field = op.type === 'attempt' ? 'attempts' : 'checkins';
                    const event = next.data[field].find(x => x.id === op.data?.id);
                    if (!event || stable(event) !== stable(op.data) || !next.uploadAcks.some(x => x.id === op.id && x.fingerprint === sent.fingerprint)) throw invalid();
                    // Drop only the acknowledged queue entry, in the same
                    // transaction that keeps its event and immutable digest.
                    return { state: promote({ ...next, pendingOperations: next.pendingOperations.filter(x => x.id !== op.id) },op), write: true };
                });
                includePromoted();
            }
            if (conflicts || (state.deferredOperations??[]).length>0) { const error=Error('some study records need review');error.code='NATIVE_EVENT_CONFLICT';throw error; }
            for (let i = 0; i < 50; i++) {
                const req = { owner: c.lease.owner, stateVersion: state.stateVersion, checkpoint: state.download.checkpoint, continuation: state.download.continuation };
                const page = await waitRequest(signal => transport.pull({ owner: req.owner, checkpoint: req.checkpoint, continuation: req.continuation, signal }), c.lease, timeoutMs);
                state = await txn(db, c.lease, c.generation, c.ticket, s => ({ state: native.projectNativeStudyPage(s, page, req, c.lease), write: true }));
                if (!state.download.continuation)
                    return state;
            }
            throw Error('synthetic page limit');
        }
        finally {
            running = false;
        }
    }
    return Object.freeze({ activate, cancel, record, prioritizeRoot, read, run });
}
export { createStudyRunner, STATE, SESSION };
