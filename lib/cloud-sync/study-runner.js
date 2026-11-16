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
        const operation = { id: operationId, owner: c.lease.owner, type: kind, data: frozen, ...(firstAttemptId === undefined ? {} : { firstAttemptId }) };
        const prepared = await native.prepareNativeUpload(operation, c.lease);
        return txn(db, c.lease, c.generation, c.ticket, state => {
            const existing = state.pendingOperations.find(x => x.id === operation.id), field = kind === 'attempt' ? 'attempts' : 'checkins', event = state.data[field].find(x => x.id === frozen.id);
            if (existing) {
                if (JSON.stringify(existing) !== JSON.stringify(operation) || !event)
                    throw Error('event conflict');
                return { state, write: false };
            }
            const acknowledgements = state.uploadAcks.filter(x => x.id === operation.id);
            if (acknowledgements.length) {
                if (acknowledgements.length !== 1 || acknowledgements[0].fingerprint !== prepared.fingerprint || !event || stable(event) !== stable(frozen))
                    throw Error('event conflict');
                return { state, write: false };
            }
            if (state.pendingOperations.length >= maxPending) {
                const error=Error('synthetic queue full');error.code='NATIVE_QUEUE_FULL';throw error;
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
            // Journal keys are not ordered. Send known roots before their
            // dependent reviews; unresolved roots stay pending on server 409.
            const ordered = [...state.pendingOperations].sort((a,b) => Number(!(a.type==='attempt'&&a.firstAttemptId===a.data?.id)) - Number(!(b.type==='attempt'&&b.firstAttemptId===b.data?.id)));
            let conflicts=false;
            for (const op of ordered) {
                const sent = await native.prepareNativeUpload(op, c.lease), matches = state.uploadAcks.filter(x => x.id === op.id);
                if (matches.length > 1 || (matches.length === 1 && matches[0].fingerprint !== sent.fingerprint))
                    throw Error('synthetic acknowledgement conflict');
                if (matches.length === 1)
                    continue;
                const captured = state;
                let response;
                try { response = await waitRequest(signal => transport.upload({ owner: c.lease.owner, wire: copy(sent.wire), signal }), c.lease, timeoutMs); }
                catch (error) { if (error?.code === 'NATIVE_EVENT_CONFLICT') { conflicts=true;continue; } throw error; }
                const next = await native.acknowledgeNativeUpload(captured, sent, response, c.lease);
                state = await txn(db, c.lease, c.generation, c.ticket, s => {
                    if (s.stateVersion !== captured.stateVersion || JSON.stringify(s) !== JSON.stringify(captured)) throw invalid();
                    const field = op.type === 'attempt' ? 'attempts' : 'checkins';
                    const event = next.data[field].find(x => x.id === op.data?.id);
                    if (!event || stable(event) !== stable(op.data) || !next.uploadAcks.some(x => x.id === op.id && x.fingerprint === sent.fingerprint)) throw invalid();
                    // Drop only the acknowledged queue entry, in the same
                    // transaction that keeps its event and immutable digest.
                    return { state: { ...next, pendingOperations: next.pendingOperations.filter(x => x.id !== op.id) }, write: true };
                });
            }
            if (conflicts) { const error=Error('some study records need review');error.code='NATIVE_EVENT_CONFLICT';throw error; }
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
    return Object.freeze({ activate, cancel, record, read, run });
}
export { createStudyRunner, STATE, SESSION };
