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
const invalid = () => Error('synthetic study state unavailable or account changed');
function fresh(owner) { return { version: 1, stateVersion: 0, owner, data: copy(model.EMPTY_DATA), download: { checkpoint: null, continuation: null, pendingProfiles: [] }, pendingOperations: [], uploadAcks: [] }; }
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
                if (lease.signal.aborted || !lease.isCurrent() || !matches(f.result, ticket) || ticket.owner !== lease.owner || meta.result?.owner !== lease.owner || meta.result?.generation !== generation || !get.result || get.result.owner !== lease.owner || get.result.version !== 1 || !Number.isSafeInteger(get.result.stateVersion) || get.result.stateVersion < 0 || get.result.stateVersion >= Number.MAX_SAFE_INTEGER || !Array.isArray(get.result.pendingOperations) || !Array.isArray(get.result.uploadAcks))
                    throw invalid();
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
        const cancel = () => done(reject, invalid()), timer = setTimeout(() => done(reject, Error('synthetic transport timeout')), timeoutMs);
        lease.signal.addEventListener('abort', cancel, { once: true });
        Promise.resolve().then(start).then(x => done(resolve, x), e => done(reject, e));
    });
}
function createStudyRunner({ db, transport, timeoutMs = 10000 } = {}) {
    if (!db || !transport || typeof transport.upload !== 'function' || typeof transport.pull !== 'function' || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000)
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
    async function record(kind, data, operationId = randomUUID()) {
        const c = current(), frozen = copy(data);
        if (!['attempt', 'checkin'].includes(kind) || !uuid.test(operationId) || !uuid.test(frozen?.id) || (kind === 'attempt' && (typeof frozen.qid !== 'string' || frozen.qid.length > 100)) || (kind === 'checkin' && !model.validStudyDate(frozen.date)))
            throw Error('invalid synthetic event');
        const operation = { id: operationId, owner: c.lease.owner, type: kind, data: frozen };
        await native.prepareNativeUpload(operation, c.lease);
        return txn(db, c.lease, c.generation, c.ticket, state => {
            if (state.pendingOperations.length >= 5000)
                throw Error('synthetic queue full');
            const existing = state.pendingOperations.find(x => x.id === operation.id), field = kind === 'attempt' ? 'attempts' : 'checkins', event = state.data[field].find(x => x.id === frozen.id);
            if (existing) {
                if (JSON.stringify(existing) !== JSON.stringify(operation) || !event)
                    throw Error('event conflict');
                return { state, write: false };
            }
            if (event || state.pendingOperations.some(x => x.type === kind && x.data?.id === frozen.id))
                throw Error('event conflict');
            state.data[field].push(frozen);
            state.pendingOperations.push(operation);
            state.stateVersion++;
            return { state, write: true };
        });
    }
    async function run() {
        if (running)
            throw Error('synthetic runner busy');
        running = true;
        try {
            const c = current();
            let state = await txn(db, c.lease, c.generation, c.ticket, s => ({ state: s, write: false }));
            for (const op of state.pendingOperations) {
                const sent = await native.prepareNativeUpload(op, c.lease), matches = state.uploadAcks.filter(x => x.id === op.id);
                if (matches.length > 1 || (matches.length === 1 && matches[0].fingerprint !== sent.fingerprint))
                    throw Error('synthetic acknowledgement conflict');
                if (matches.length === 1)
                    continue;
                const captured = state;
                const response = await waitRequest(() => transport.upload({ owner: c.lease.owner, wire: copy(sent.wire), signal: c.lease.signal }), c.lease, timeoutMs);
                const next = await native.acknowledgeNativeUpload(captured, sent, response, c.lease);
                state = await txn(db, c.lease, c.generation, c.ticket, s => { if (s.stateVersion !== captured.stateVersion || JSON.stringify(s) !== JSON.stringify(captured))
                    throw invalid(); return { state: next, write: true }; });
            }
            for (let i = 0; i < 50; i++) {
                const req = { owner: c.lease.owner, stateVersion: state.stateVersion, checkpoint: state.download.checkpoint, continuation: state.download.continuation };
                const page = await waitRequest(() => transport.pull({ owner: req.owner, checkpoint: req.checkpoint, continuation: req.continuation, signal: c.lease.signal }), c.lease, timeoutMs);
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
    return Object.freeze({ activate, cancel, record, read, run });
}
export { createStudyRunner, STATE, SESSION };
