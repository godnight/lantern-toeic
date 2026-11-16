'use strict';
// Synthetic orchestration only. This is NOT an ArkWeb/native credential bridge.
// Only use with a transport which has independently authenticated the session.
import * as queue from './offline-queue.js';
import {FENCE,matches} from './idb-fence.js';

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
  async function call(state, method, payload) {
    check(state);
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
        check(state); return transport[method](payload, controller.signal);
      }), timeout, aborted]);
      check(state);
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
  async function run({pageSize = 50} = {}) {
    const state = current;
    if (!state) throw Error('no session');
    if (state.running) throw Error('sync busy');
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) throw Error('invalid page size');
    state.running = true;
    try {
      // Serial dispatch bounds memory and makes a lost response retry the exact event.
      const initial = await read(state);
      // An unacknowledged review must precede its correction even if an
      // interrupted importer inserted the records in the opposite order.
      const pending = initial.queue.filter(row => !row.acked).sort((a,b) =>
        Number(a.event?.type === 'review-correction') - Number(b.event?.type === 'review-correction'));
      const ackedReviews = new Set(initial.queue.filter(row => row.acked && row.event?.type === 'review').map(row => row.id));
      let conflict = false;
      for (const item of pending) {
        check(state);
        // A correction may be sent only after this same queue has a confirmed
        // acknowledgement of its review. Unknown/missing dependencies remain
        // pending; the independent records in this run can still progress.
        if (item.event?.type === 'review-correction' && !ackedReviews.has(item.event.reviewId)) { conflict = true; continue; }
        let ack;
        try { ack = await call(state, 'append', {owner:state.session.owner, event: item.event}); }
        catch (error) { if (error?.code === 'NATIVE_EVENT_CONFLICT') { conflict = true; continue; } throw error; }
        check(state);
        await queue.acknowledge(db, state.session, item.event, ack);
        if (item.event?.type === 'review') ackedReviews.add(item.id);
      }
      // Do not advance the download snapshot/checkpoint while any local event
      // is unresolved; leave its bytes and pending queue entry for recovery.
      if (conflict) { const error=Error('some vocabulary records need review');error.code='NATIVE_EVENT_CONFLICT';throw error; }
      let local = await read(state);
      if (local.download.snapshot === null) {
        const metadata = await call(state, 'begin', {owner:state.session.owner, pageSize});
        await queue.beginSnapshot(db, state.session, metadata);
      }
      let pages = 0;
      for (;;) {
        local = await read(state);
        const d = local.download;
        if (d.snapshot === null) break;
        // A bad or cyclic server must not keep a single run alive forever.
        if (++pages > 1000) throw Error('page limit reached');
        const request = {owner: state.session.owner, snapshot:d.snapshot, cursor:d.cursor, upper:d.upper};
        const page = await call(state, 'page', {owner:state.session.owner, snapshot:d.snapshot, cursor:d.cursor});
        await queue.applySnapshotPage(db, state.session, request, page, project);
      }
    } finally { state.running = false; }
  }
  return {activate, cancel, enqueue, run};
}
export {createRunner};
