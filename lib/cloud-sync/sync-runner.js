'use strict';
// Synthetic orchestration only. This is NOT an ArkWeb/native credential bridge.
// Only use with a transport which has independently authenticated the session.
import * as queue from './offline-queue.js';
import {FENCE,matches} from './idb-fence.js';
import {validVocabularyEvent,vocabularyReviewHash} from '../vocabulary-model';

function createRunner({db, project, transport, timeoutMs = 15000}) {
  if (!db || typeof project !== 'function' || !transport ||
      !['append', 'begin', 'page'].every(k => typeof transport[k] === 'function') ||
      !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000) throw Error('invalid configuration');
  let current = null;
  function cancel() {
    if (!current) return;
    const old = current; current = null;
    queue.revokeSession(old.session);
  }
  function activate(owner,ticket) {
    if (typeof owner !== 'string' || !/^usr_[a-f0-9-]{36}$/.test(owner)) throw Error('invalid owner');
    cancel();
    const state = {session: queue.createSession(owner,ticket), running: false};
    current = state;
    return Object.freeze({owner});
  }
  function check(state) {
    if (current !== state || !state.session.isCurrent()) throw Error('session revoked');
  }
  function read(state) {
    check(state);
    return new Promise((resolve, reject) => {
      const tx = db.transaction([queue.STORE,FENCE], 'readonly');
      let value,active;
      const abort = () => { try { tx.abort(); } catch {} };
      state.session.signal.addEventListener('abort', abort, {once: true});
      tx.objectStore(queue.STORE).get(state.session.owner).onsuccess = e => { value = e.target.result; };
      tx.objectStore(FENCE).get('active').onsuccess = e => { active = e.target.result; };
      tx.oncomplete = () => {
        state.session.signal.removeEventListener('abort', abort);
        try { check(state); if (!matches(active,state.session.ticket)||!value || value.owner !== state.session.owner) throw Error('invalid state'); resolve(value); } catch(e) { reject(e); }
      };
      tx.onabort = () => { state.session.signal.removeEventListener('abort', abort); reject(Error('read aborted')); };
    });
  }
  async function call(state, method, payload, sourceGuard) {
    check(state);
    const checkSource=()=>{if(sourceGuard&&sourceGuard()!==true){const error=Error('vocabulary source changed');error.code='NATIVE_TRANSIENT';throw error;}};
    const controller = new AbortController();
    const abort = () => controller.abort();
    state.session.signal.addEventListener('abort', abort, {once: true});
    let timer;
    try {
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => { const error=Error('timeout');error.code='NATIVE_TRANSIENT';reject(error);controller.abort(); }, timeoutMs);
      });
      const aborted = new Promise((_, reject) => {
        controller.signal.addEventListener('abort', () => reject(Error('request aborted')), {once:true});
      });
      const result = await Promise.race([Promise.resolve().then(() => {
        check(state);checkSource(); return transport[method](payload, controller.signal);
      }), timeout, aborted]);
      check(state);checkSource();
      return result;
    } finally {
      clearTimeout(timer);
      state.session.signal.removeEventListener('abort', abort);
    }
  }
  async function enqueue(event,sourceGuard) {
    const state = current;
    if (!state) throw Error('no session');
    check(state);
    return queue.enqueue(db, state.session, event, project,sourceGuard);
  }
  async function run({pageSize = 50, blockedEventIds = [], sourceUnresolved = false, sourceGuard} = {}) {
    const state = current;
    if (!state) throw Error('no session');
    if (state.running) throw Error('sync busy');
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) throw Error('invalid page size');
    if (!Array.isArray(blockedEventIds) || blockedEventIds.length>100000 || blockedEventIds.some(id=>typeof id!=='string'||!id) ||
        typeof sourceUnresolved!=='boolean' || (sourceGuard!==undefined&&typeof sourceGuard!=='function')) throw Error('invalid source status');
    const blocked=new Set(blockedEventIds);
    const checkSource=()=>{check(state);if(sourceGuard&&sourceGuard()!==true){const error=Error('vocabulary source changed');error.code='NATIVE_TRANSIENT';throw error;}};
    checkSource();
    state.running = true;
    try {
      // Serial dispatch bounds memory and makes a lost response retry the exact event.
      const initial = await read(state);
      // An unacknowledged review must precede its correction even if an
      // interrupted importer inserted the records in the opposite order.
      const pending = initial.queue.filter(row => !row.acked).sort((a,b) =>
        Number(a.event?.type === 'review-correction') - Number(b.event?.type === 'review-correction'));
      const ackedReviews = new Map(initial.queue.filter(row => row.acked && row.event?.type === 'review').map(row => [row.id,row.event]));
      const pendingReviews = new Set(initial.queue.filter(row => !row.acked && row.event?.type === 'review').map(row => row.id));
      const reviewEvents = new Map(),seenEventIds = new Set(),duplicateEventIds = new Set();
      for(const event of initial.events){
        const id=event?.id;if(seenEventIds.has(id))duplicateEventIds.add(id);else seenEventIds.add(id);
        if(event?.type === 'review')reviewEvents.set(event.id,event);
      }
      let conflict = sourceUnresolved || blocked.size>0;
      for (const item of pending) {
        checkSource();
        if(blocked.has(item.id)||(item.event?.type==='review-correction'&&blocked.has(item.event.reviewId))){conflict=true;continue;}
        if (item.event?.type === 'review-correction') {
          const original = reviewEvents.get(item.event.reviewId);
          // The downloaded event alone is not proof that this exact payload
          // remains on the server. Validate the dependency before using it.
          if (duplicateEventIds.has(item.event.reviewId) || !validVocabularyEvent(item.event) || !validVocabularyEvent(original) || original.type !== 'review' ||
              original.grade !== 'remembered' || original.wordId !== item.event.wordId ||
              Date.parse(item.event.createdAt) < Date.parse(original.createdAt) || vocabularyReviewHash(original) !== item.event.reviewHash) {
            conflict = true; continue;
          }
          if(ackedReviews.has(original.id) && (!validVocabularyEvent(ackedReviews.get(original.id)) ||
              vocabularyReviewHash(ackedReviews.get(original.id)) !== vocabularyReviewHash(original))){conflict=true;continue;}
          if (!ackedReviews.has(item.event.reviewId)) {
            // A queued but rejected parent must not be retried in the same
            // pass. If the parent came from a download and has no queue row,
            // queue and resend that exact event, then await a real ACK first.
            if (pendingReviews.has(item.event.reviewId)) { conflict = true; continue; }
            try {
              await queue.enqueue(db,state.session,original,project);
              check(state);
              const parentAck=await call(state,'append',{owner:state.session.owner,event:original},sourceGuard);
              check(state);
              await queue.acknowledge(db,state.session,original,parentAck);
              ackedReviews.set(original.id,original);
            } catch(error) { if(error?.code==='NATIVE_EVENT_CONFLICT'){conflict=true;pendingReviews.add(original.id);continue;} throw error; }
          }
        }
        let ack;
        try { ack = await call(state, 'append', {owner:state.session.owner, event: item.event},sourceGuard); }
        catch (error) { if (error?.code === 'NATIVE_EVENT_CONFLICT') { conflict = true; continue; } throw error; }
        check(state);
        await queue.acknowledge(db, state.session, item.event, ack);
        if (item.event?.type === 'review') ackedReviews.set(item.id,item.event);
      }
      // Do not advance the download snapshot/checkpoint while any local event
      // is unresolved; leave its bytes and pending queue entry for recovery.
      if (conflict) { const error=Error('some vocabulary records need review');error.code='NATIVE_EVENT_CONFLICT';throw error; }
      let local = await read(state);
      if (local.download.snapshot === null) {
        const metadata = await call(state, 'begin', {owner:state.session.owner, pageSize},sourceGuard);
        await queue.beginSnapshot(db, state.session, metadata,sourceGuard);
      }
      let pages = 0;
      for (;;) {
        local = await read(state);
        const d = local.download;
        if (d.snapshot === null) break;
        // A bad or cyclic server must not keep a single run alive forever.
        if (++pages > 1000) throw Error('page limit reached');
        const request = {owner: state.session.owner, snapshot:d.snapshot, cursor:d.cursor, upper:d.upper};
        const page = await call(state, 'page', {owner:state.session.owner, snapshot:d.snapshot, cursor:d.cursor},sourceGuard);
        await queue.applySnapshotPage(db, state.session, request, page, project,sourceGuard);
      }
    } finally { state.running = false; }
  }
  return {activate, cancel, enqueue, run};
}
export {createRunner};
