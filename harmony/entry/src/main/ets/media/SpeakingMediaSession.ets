import { TrustedOwnerLease, TrustedOwnerProvider } from './VerifiedOwnerLease';
import { SpeakingRecorderPort, RecordedMedia, CaptureFailure } from './AVRecorderCapture';
import { MediaRequest, MediaReply, MediaScope, MEDIA_CHUNK_BYTES, MEDIA_MAX_BYTES,
  MEDIA_MAX_CHUNKS, MEDIA_HANDLE_MS, MEDIA_LIFETIME_MS } from './SpeakingMediaPolicy';

interface Capture {
  id: string;
  generation: number;
  uid: string;
  authEpoch: number;
  ownerDeadline: number;
  createdAt: number;
  state: string;
  revision: number;
  errorCode: string;
  recorder: SpeakingRecorderPort;
  started: boolean;
  reading: boolean;
  closing: boolean;
  nextIndex: number;
  readDeadline: number;
  result?: RecordedMedia;
  startPromise?: Promise<void>;
  startWait?: Promise<void>;
  finalizePromise?: Promise<void>;
  cleanupPromise?: Promise<void>;
  prepareTimer: number;
  limitTimer: number;
  expiryTimer: number;
}
interface Tombstone {
  captureId: string;
  generation: number;
  state: string;
  revision: number;
  errorCode?: string;
  endedAt: number;
}
const terminal = (state: string): boolean => ['ACKED', 'FAILED', 'CANCELLED', 'EXPIRED'].includes(state);
const errors: string[] = ['UNSUPPORTED', 'PERMISSION_DENIED', 'BUSY', 'START_FAILED', 'WRITE_FAILED',
  'FINALIZE_FAILED', 'READ_FAILED', 'CANCELLED', 'STALE_GENERATION', 'SIZE_LIMIT', 'EMPTY_RECORDING', 'INTERRUPTED'];

/** Pure lifecycle/state owner. No auth wire, page UID, path or learner store.
 * One global slot remains held until every late recorder operation is reclaimed. */
export class SpeakingMediaSession {
  private static slot: Capture | undefined = undefined;
  private static seenCaptures: Set<string> = new Set<string>();
  private active: Capture | undefined = undefined;
  private tombstones: Tombstone[] = [];
  private provider: TrustedOwnerProvider;
  private liveDocument: () => boolean;
  private factory: () => SpeakingRecorderPort;
  private clock: () => number;
  private deliver: (reply: MediaReply, bytes?: ArrayBuffer) => boolean;

  constructor(provider: TrustedOwnerProvider, liveDocument: () => boolean, factory: () => SpeakingRecorderPort,
    clock: () => number, deliver: (reply: MediaReply, bytes?: ArrayBuffer) => boolean) {
    this.provider = provider; this.liveDocument = liveDocument; this.factory = factory;
    this.clock = clock; this.deliver = deliver;
  }

  busy(): boolean { return SpeakingMediaSession.slot !== undefined; }

  private current(capture: Capture): boolean {
    const lease: TrustedOwnerLease | undefined = this.provider.snapshot(), now: number = this.clock();
    return this.active === capture && this.liveDocument() && lease !== undefined && lease.uid === capture.uid &&
      lease.authEpoch === capture.authEpoch && Number.isFinite(now) && now >= capture.createdAt &&
      now < capture.ownerDeadline && now < lease.expiresAtUptimeMs;
  }

  private snapshot(capture: Capture): MediaReply {
    const reply: MediaReply = { version: 1, id: '', captureId: capture.id, generation: capture.generation,
      state: capture.state, revision: capture.revision };
    // Query computes expiry without advancing a cursor, renewing a lease, or
    // invoking recorder/cleanup. Independent timers perform physical cleanup.
    if (['READY', 'READING'].includes(capture.state) && this.expired(capture)) {
      reply.state = 'EXPIRED'; reply.revision++;
      return reply;
    }
    if (capture.errorCode !== '') reply.errorCode = capture.errorCode;
    if (capture.result !== undefined && ['READY', 'READING'].includes(reply.state)) {
      reply.nextChunkIndex = capture.nextIndex; reply.totalChunks = capture.result.totalChunks;
      reply.totalBytes = capture.result.totalBytes; reply.sha256 = capture.result.sha256;
      reply.mime = capture.result.mime; reply.durationMs = capture.result.durationMs;
    }
    return reply;
  }

  private reply(input: MediaRequest, capture?: Capture, result?: string, errorCode?: string): void {
    const reply: MediaReply = capture === undefined ? { version: 1, id: input.id, state: 'UNKNOWN_CAPTURE', revision: 0 } : this.snapshot(capture);
    reply.id = input.id;
    if (capture === undefined && input.captureId !== undefined) { reply.captureId = input.captureId; reply.generation = input.generation; }
    if (result !== undefined) reply.result = result;
    if (errorCode !== undefined) reply.errorCode = errorCode;
    this.deliver(reply);
  }

  private transition(capture: Capture, state: string, errorCode: string = ''): void {
    if (capture.state !== state) { capture.state = state; capture.revision++; }
    capture.errorCode = errorCode;
  }

  private clearTimers(capture: Capture): void {
    for (const timer of [capture.prepareTimer, capture.limitTimer, capture.expiryTimer]) if (timer !== -1) clearTimeout(timer);
    capture.prepareTimer = -1; capture.limitTimer = -1; capture.expiryTimer = -1;
  }

  private reclaim(capture: Capture, acknowledged: boolean = false): Promise<void> {
    if (capture.cleanupPromise !== undefined) return capture.cleanupPromise;
    capture.closing = true;
    this.clearTimers(capture);
    let cleaned: boolean = true;
    capture.cleanupPromise = capture.recorder.dispose().catch(() => {
      cleaned = false;
      this.transition(capture, 'FAILED', 'WRITE_FAILED');
    }).then(() => {
      // Keep the one global slot on cleanup failure: do not accumulate orphan
      // files or claim deletion. A matching detach/lifecycle may retry cleanup.
      if (!cleaned) { capture.cleanupPromise = undefined; capture.closing = false; return; }
      if (acknowledged && capture.state === 'READING' && this.current(capture)) this.transition(capture, 'ACKED');
      if (this.active === capture) {
        const now: number = this.clock();
        const row: Tombstone = { captureId: capture.id, generation: capture.generation,
          state: capture.state, revision: capture.revision, endedAt: now };
        if (capture.errorCode !== '') row.errorCode = capture.errorCode;
        this.tombstones = this.tombstones.filter(item => Number.isFinite(now) && now >= item.endedAt && now - item.endedAt < MEDIA_LIFETIME_MS);
        this.tombstones.push(row);
        if (this.tombstones.length > 8) this.tombstones.shift();
        this.active = undefined;
      }
      // A stale completion can never free another capture's process-wide lock.
      if (SpeakingMediaSession.slot === capture) SpeakingMediaSession.slot = undefined;
      capture.result = undefined;
    });
    return capture.cleanupPromise;
  }

  private fail(capture: Capture, errorCode: string): void {
    if (terminal(capture.state)) return;
    this.transition(capture, 'FAILED', errorCode);
    void this.reclaim(capture);
  }

  invalidate(): void {
    const capture: Capture | undefined = this.active;
    if (capture === undefined) return;
    if (!terminal(capture.state)) this.fail(capture, 'STALE_GENERATION');
    else if (capture.errorCode === 'WRITE_FAILED') void this.reclaim(capture);
  }

  detach(scope: MediaScope): void {
    const capture: Capture | undefined = this.active;
    if (capture !== undefined && capture.id === scope.captureId && capture.generation === scope.generation && this.current(capture)) {
      if (capture.state === 'FAILED' && capture.errorCode === 'WRITE_FAILED') void this.reclaim(capture);
      else this.fail(capture, 'STALE_GENERATION');
    }
  }

  private expired(capture: Capture): boolean {
    const now: number = this.clock();
    return !Number.isFinite(now) || now < capture.createdAt || now >= capture.createdAt + MEDIA_LIFETIME_MS ||
      capture.readDeadline > 0 && now >= capture.readDeadline;
  }

  private armExpiry(capture: Capture): void {
    if (capture.expiryTimer !== -1) clearTimeout(capture.expiryTimer);
    const deadline: number = Math.min(capture.createdAt + MEDIA_LIFETIME_MS,
      capture.readDeadline > 0 ? capture.readDeadline : capture.createdAt + MEDIA_LIFETIME_MS);
    capture.expiryTimer = setTimeout(() => {
      if (this.active !== capture || terminal(capture.state)) return;
      this.transition(capture, 'EXPIRED'); void this.reclaim(capture);
    }, Math.max(1, deadline - this.clock()));
  }

  private code(error: Error, fallback: string): string {
    const code: string = (error as CaptureFailure).code;
    return errors.includes(code) ? code : fallback;
  }

  private async start(input: MediaRequest): Promise<void> {
    const old: Capture | undefined = this.active;
    if (old !== undefined && old.id === input.captureId && old.generation === input.generation) { this.reply(input, old, 'ALREADY_ACCEPTED'); return; }
    if (SpeakingMediaSession.seenCaptures.has(input.captureId ?? '')) { this.reply(input, undefined, 'CONFLICT'); return; }
    if (this.busy() || SpeakingMediaSession.seenCaptures.size >= 512) { this.reply(input, undefined, undefined, 'BUSY'); return; }
    const lease: TrustedOwnerLease | undefined = this.provider.snapshot(), now: number = this.clock();
    if (!this.liveDocument() || lease === undefined || !Number.isFinite(now) || now < 0 || now >= lease.expiresAtUptimeMs) { this.reply(input, undefined, undefined, 'STALE_GENERATION'); return; }
    const capture: Capture = { id: input.captureId!, generation: input.generation!, uid: lease.uid,
      authEpoch: lease.authEpoch, ownerDeadline: lease.expiresAtUptimeMs, createdAt: now,
      state: 'STARTED', revision: 1, errorCode: '', recorder: this.factory(), started: false, reading: false, closing: false,
      nextIndex: 0, readDeadline: 0, prepareTimer: -1, limitTimer: -1, expiryTimer: -1 };
    SpeakingMediaSession.seenCaptures.add(capture.id); this.active = capture; SpeakingMediaSession.slot = capture;
    // The absolute lifetime also bounds a stuck finalization, before READY or
    // the first read can arm the shorter handle deadline.
    this.armExpiry(capture);
    let preparationEnded: () => void = () => {};
    const deadline: Promise<void> = new Promise<void>((resolve) => { preparationEnded = resolve; });
    capture.prepareTimer = setTimeout(() => {
      if (!capture.started && !terminal(capture.state)) this.fail(capture, 'START_FAILED');
      preparationEnded();
    }, 15000);
    capture.startPromise = capture.recorder.start(input.maxDurationMs!, (event: string) => {
      if (!this.current(capture) || terminal(capture.state)) return;
      if (event === 'LIMIT') void this.finalize(capture);
      else this.fail(capture, 'INTERRUPTED');
    }).then(() => {
      if (!this.current(capture) || terminal(capture.state)) { void this.reclaim(capture); return; }
      capture.started = true;
      if (capture.prepareTimer !== -1) clearTimeout(capture.prepareTimer);
      capture.prepareTimer = -1;
      capture.limitTimer = setTimeout(() => { if (this.current(capture) && capture.state === 'STARTED') void this.finalize(capture); }, input.maxDurationMs!);
    }).catch((error: Error) => { this.fail(capture, this.code(error, 'START_FAILED')); });
    capture.startWait = Promise.race([capture.startPromise, deadline]);
    await capture.startWait;
    if (this.current(capture) || terminal(capture.state)) this.reply(input, capture);
  }

  private finalize(capture: Capture): Promise<void> {
    if (capture.finalizePromise !== undefined) return capture.finalizePromise;
    this.transition(capture, 'FINALIZING');
    if (capture.limitTimer !== -1) clearTimeout(capture.limitTimer);
    capture.limitTimer = -1;
    capture.finalizePromise = capture.recorder.finish().then((result: RecordedMedia) => {
      if (!this.current(capture) || capture.state !== 'FINALIZING') { void this.reclaim(capture); return; }
      if (!Number.isSafeInteger(result.totalBytes) || result.totalBytes < 1 || result.totalBytes > MEDIA_MAX_BYTES ||
        result.totalChunks !== Math.ceil(result.totalBytes / MEDIA_CHUNK_BYTES) || result.totalChunks > MEDIA_MAX_CHUNKS ||
        result.mime !== 'audio/mp4' || !/^[a-f0-9]{64}$/.test(result.sha256) || !Number.isFinite(result.durationMs) || result.durationMs < 1 || result.durationMs > 120000) {
        this.fail(capture, 'FINALIZE_FAILED'); return;
      }
      capture.result = result; this.transition(capture, 'READY'); this.armExpiry(capture);
    }).catch((error: Error) => { this.fail(capture, this.code(error, 'FINALIZE_FAILED')); });
    return capture.finalizePromise;
  }

  private query(input: MediaRequest): void {
    const capture: Capture | undefined = this.active;
    if (capture !== undefined && (input.captureId === undefined || input.captureId === capture.id && input.generation === capture.generation)) { this.reply(input, capture); return; }
    if (input.captureId === undefined) { this.deliver({ version: 1, id: input.id, state: 'IDLE', revision: 0 }); return; }
    const now: number = this.clock(), old: Tombstone | undefined = this.tombstones.find(item => item.captureId === input.captureId && item.generation === input.generation && now >= item.endedAt && now - item.endedAt < MEDIA_LIFETIME_MS);
    if (old === undefined) { this.reply(input); return; }
    const reply: MediaReply = { version: 1, id: input.id, captureId: old.captureId, generation: old.generation, state: old.state, revision: old.revision };
    if (old.errorCode !== undefined) reply.errorCode = old.errorCode;
    this.deliver(reply);
  }

  async dispatch(input: MediaRequest): Promise<void> {
    if (!this.liveDocument() || this.provider.snapshot() === undefined) { this.reply(input, undefined, undefined, 'STALE_GENERATION'); return; }
    if (input.action === 'query') {
      const pending: Capture | undefined = this.active;
      // Observe an existing preparation; never publish a physical STARTED
      // confirmation while the recorder's original start is still pending.
      if (pending !== undefined && pending.state === 'STARTED' && !pending.started &&
        (input.captureId === undefined || input.captureId === pending.id && input.generation === pending.generation) && pending.startWait !== undefined) await pending.startWait;
      if (this.liveDocument() && this.provider.snapshot() !== undefined) this.query(input);
      return;
    }
    if (input.action === 'start') { await this.start(input); return; }
    const capture: Capture | undefined = this.active;
    if (capture === undefined || input.captureId !== capture.id || input.generation !== capture.generation) {
      // Terminal replay never needs a file or invokes a recorder.
      this.query(input); return;
    }
    if (!this.current(capture)) { this.reply(input, undefined, undefined, 'STALE_GENERATION'); return; }
    if (terminal(capture.state)) { this.reply(input, capture, 'ALREADY_ACCEPTED'); return; }
    if (capture.closing || capture.cleanupPromise !== undefined) { this.reply(input, capture, 'ALREADY_ACCEPTED'); return; }
    if (input.action === 'stop') {
      if (capture.state !== 'STARTED') { this.reply(input, capture, 'ALREADY_ACCEPTED'); return; }
      let timer: number = -1;
      const unknown: Promise<void> = new Promise<void>(resolve => { timer = setTimeout(resolve, 30000); });
      await Promise.race([this.finalize(capture), unknown]); if (timer !== -1) clearTimeout(timer);
      if (this.current(capture)) this.reply(input, capture);
      return;
    }
    if (input.action === 'cancel') {
      if (capture.state !== 'STARTED') { this.reply(input, capture, 'TOO_LATE'); return; }
      this.transition(capture, 'CANCELLED'); await this.reclaim(capture); this.reply(input, capture); return;
    }
    if (this.expired(capture)) { this.transition(capture, 'EXPIRED'); await this.reclaim(capture); this.reply(input, capture); return; }
    if (input.action === 'readChunk') {
      const result: RecordedMedia | undefined = capture.result;
      if (!['READY', 'READING'].includes(capture.state) || result === undefined || capture.reading ||
        input.index! >= result.totalChunks || input.index !== capture.nextIndex && input.index !== capture.nextIndex - 1) { this.reply(input, capture, 'CONFLICT'); return; }
      capture.reading = true;
      this.transition(capture, 'READING');
      if (capture.readDeadline === 0) { capture.readDeadline = this.clock() + MEDIA_HANDLE_MS; this.armExpiry(capture); }
      try {
        const bytes: ArrayBuffer = await capture.recorder.read(input.index!);
        if (!this.current(capture) || this.expired(capture)) return;
        const length: number = Math.min(MEDIA_CHUNK_BYTES, result.totalBytes - input.index! * MEDIA_CHUNK_BYTES);
        if (bytes.byteLength !== length || bytes.byteLength < 1 || bytes.byteLength > MEDIA_CHUNK_BYTES) { this.fail(capture, 'READ_FAILED'); this.reply(input, capture); return; }
        const reply: MediaReply = this.snapshot(capture); reply.id = input.id; reply.index = input.index;
        reply.nextChunkIndex = Math.max(capture.nextIndex, input.index! + 1);
        if (this.deliver(reply, bytes)) capture.nextIndex = reply.nextChunkIndex;
      } catch { this.fail(capture, 'READ_FAILED'); this.reply(input, capture); }
      finally { capture.reading = false; }
      return;
    }
    if (input.action === 'ack') {
      const result: RecordedMedia | undefined = capture.result;
      if (capture.state !== 'READING' || result === undefined || capture.reading || capture.nextIndex !== result.totalChunks ||
        input.blobSha256 !== result.sha256 || input.byteLength !== result.totalBytes) { this.reply(input, capture, 'CONFLICT'); return; }
      // Only the Web caller's confirmed local-save path may issue this action.
      // Cleanup success precedes ACKED and the acknowledgement response.
      await this.reclaim(capture, true); this.reply(input, capture);
    }
  }
}
