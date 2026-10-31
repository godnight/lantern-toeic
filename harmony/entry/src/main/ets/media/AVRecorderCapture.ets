import media from '@ohos.multimedia.media';
import audio from '@ohos.multimedia.audio';
import fs from '@ohos.file.fs';
import util from '@ohos.util';
import cryptoFramework from '@ohos.security.cryptoFramework';
import deviceInfo from '@ohos.deviceInfo';
import abilityAccessCtrl from '@ohos.abilityAccessCtrl';
import { common } from '@kit.AbilityKit';
import { systemDateTime } from '@kit.BasicServicesKit';
import { MEDIA_CHUNK_BYTES, MEDIA_MAX_BYTES, MEDIA_MAX_MS } from './SpeakingMediaPolicy';

export interface RecordedMedia {
  totalBytes: number;
  totalChunks: number;
  sha256: string;
  mime: string;
  durationMs: number;
}
export interface SpeakingRecorderPort {
  start(maxDurationMs: number, event: (code: string) => void): Promise<void>;
  finish(): Promise<RecordedMedia>;
  read(index: number): Promise<ArrayBuffer>;
  dispose(): Promise<void>;
}
export class CaptureFailure extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.code = code; }
}
function uptime(): number { return systemDateTime.getUptime(systemDateTime.TimeType.STARTUP, false); }

/** Native AAC-LC/M4A only. The page supplies no path, source, MIME or encoder.
 * No permission prompt, player, ASR, upload or learner storage is opened here. */
export class AVRecorderCapture implements SpeakingRecorderPort {
  private context: common.UIAbilityContext;
  private recorder: media.AVRecorder | undefined = undefined;
  private file: fs.File | undefined = undefined;
  private path: string = '';
  private cancelled: boolean = false;
  private recording: boolean = false;
  private ending: boolean = false;
  private began: number = 0;
  private ended: number = 0;
  private maxMs: number = 0;
  private descriptor: string = '';
  private result: RecordedMedia | undefined = undefined;
  private starting: Promise<void> | undefined = undefined;
  private finishing: Promise<RecordedMedia> | undefined = undefined;
  private cleanup: Promise<void> | undefined = undefined;
  private routing: audio.AudioRoutingManager | undefined = undefined;
  private routeChanged: (action: audio.DeviceChangeAction) => void = () => {};
  private static coldCleaned: boolean = false;

  constructor(context: common.UIAbilityContext) { this.context = context; }
  private live(): void { if (this.cancelled) throw new CaptureFailure('STALE_GENERATION'); }

  private directory(): string {
    const directory: string = this.context.cacheDir + '/lantern-speaking-v1';
    try { fs.mkdirSync(directory); } catch {
      if (!fs.lstatSync(directory).isDirectory()) throw new CaptureFailure('WRITE_FAILED');
    }
    if (!AVRecorderCapture.coldCleaned) {
      const names: string[] = fs.listFileSync(directory);
      if (names.length > 256) throw new CaptureFailure('WRITE_FAILED');
      for (const name of names) {
        if (/^capture-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.m4a$/.test(name) &&
          fs.lstatSync(directory + '/' + name).isFile()) fs.unlinkSync(directory + '/' + name);
      }
      AVRecorderCapture.coldCleaned = true;
    }
    return directory;
  }

  start(maxDurationMs: number, event: (code: string) => void): Promise<void> {
    if (this.starting !== undefined) return Promise.reject(new CaptureFailure('BUSY'));
    this.starting = this.startWork(maxDurationMs, event);
    return this.starting;
  }

  private async startWork(maxDurationMs: number, event: (code: string) => void): Promise<void> {
    this.live();
    if (deviceInfo.sdkApiVersion < 23 || !canIUse('SystemCapability.Multimedia.Media.AVRecorder')) throw new CaptureFailure('UNSUPPORTED');
    if (abilityAccessCtrl.createAtManager().verifyAccessTokenSync(this.context.applicationInfo.accessTokenId,
      'ohos.permission.MICROPHONE') !== 0) throw new CaptureFailure('PERMISSION_DENIED');
    if (!Number.isSafeInteger(maxDurationMs) || maxDurationMs < 1 || maxDurationMs > MEDIA_MAX_MS) throw new CaptureFailure('SIZE_LIMIT');
    this.maxMs = maxDurationMs;
    this.recorder = await media.createAVRecorder();
    this.live();
    const recorder: media.AVRecorder = this.recorder;
    const encoders: media.EncoderInfo[] = await recorder.getAvailableEncoder();
    this.live();
    if (!encoders.some((encoder: media.EncoderInfo): boolean => encoder.type === 'audio' &&
      encoder.mimeType === media.CodecMimeType.AUDIO_AAC && encoder.sampleRate !== undefined && encoder.sampleRate.includes(48000) &&
      encoder.channels !== undefined && encoder.channels.min <= 1 && encoder.channels.max >= 1 &&
      encoder.bitRate !== undefined && encoder.bitRate.min <= 64000 && encoder.bitRate.max >= 64000)) throw new CaptureFailure('UNSUPPORTED');
    recorder.on('error', () => { if (this.recording && !this.cancelled && !this.ending) event('INTERRUPTED'); });
    recorder.on('stateChange', (state: media.AVRecorderState) => {
      if (!this.recording || this.ending || this.cancelled) return;
      if (state === 'stopped' && uptime() - this.began >= this.maxMs - 250) event('LIMIT');
      else if (state === 'paused' || state === 'stopped' || state === 'released' || state === 'error') event('INTERRUPTED');
    });
    recorder.on('audioCapturerChange', (change: audio.AudioCapturerChangeInfo) => {
      if (!this.recording || this.ending || this.cancelled) return;
      const descriptor: string = change.deviceDescriptors.map((d: audio.AudioDeviceDescriptor): string => d.id + ':' + d.deviceRole + ':' + d.deviceType).join(',');
      if (change.muted === true || this.descriptor !== '' && descriptor !== this.descriptor) event('INTERRUPTED');
      else this.descriptor = descriptor;
    });
    this.routing = audio.getAudioManager().getRoutingManager();
    this.routeChanged = () => { if (this.recording && !this.ending && !this.cancelled) event('INTERRUPTED'); };
    this.routing.on('deviceChange', audio.DeviceFlag.INPUT_DEVICES_FLAG, this.routeChanged);
    this.path = this.directory() + '/capture-' + util.generateRandomUUID().toLowerCase() + '.m4a';
    if (fs.accessSync(this.path)) throw new CaptureFailure('WRITE_FAILED');
    this.file = fs.openSync(this.path, fs.OpenMode.CREATE | fs.OpenMode.READ_WRITE);
    const config: media.AVRecorderConfig = {
      audioSourceType: media.AudioSourceType.AUDIO_SOURCE_TYPE_MIC,
      profile: { audioBitrate: 64000, audioChannels: 1, audioCodec: media.CodecMimeType.AUDIO_AAC,
        aacProfile: media.AacProfile.AAC_LC, audioSampleRate: 48000, fileFormat: media.ContainerFormatType.CFT_MPEG_4A },
      url: 'fd://' + this.file.fd, maxDuration: Math.ceil(maxDurationMs / 1000)
    };
    await recorder.prepare(config);
    this.live();
    await recorder.start();
    this.live();
    this.began = uptime();
    if (!Number.isFinite(this.began) || this.began < 0) throw new CaptureFailure('START_FAILED');
    this.recording = true;
  }

  finish(): Promise<RecordedMedia> {
    if (this.finishing === undefined) this.finishing = this.finishWork();
    return this.finishing;
  }

  private async finishWork(): Promise<RecordedMedia> {
    this.live();
    if (this.starting !== undefined) await this.starting;
    this.live();
    this.ending = true;
    this.ended = uptime();
    const recorder: media.AVRecorder | undefined = this.recorder;
    if (recorder === undefined || !this.recording) throw new CaptureFailure('FINALIZE_FAILED');
    if (!Number.isFinite(this.ended) || this.ended < this.began) throw new CaptureFailure('FINALIZE_FAILED');
    if (recorder.state !== 'stopped') await recorder.stop();
    this.live();
    await recorder.release();
    this.recorder = undefined;
    this.recording = false;
    this.removeRouteListener();
    if (this.file !== undefined) { fs.closeSync(this.file.fd); this.file = undefined; }
    const stat: fs.Stat = fs.lstatSync(this.path), totalBytes: number = stat.size;
    if (!stat.isFile() || !Number.isSafeInteger(totalBytes)) throw new CaptureFailure('READ_FAILED');
    if (totalBytes < 1) throw new CaptureFailure('EMPTY_RECORDING');
    if (totalBytes > MEDIA_MAX_BYTES) throw new CaptureFailure('SIZE_LIMIT');
    if (totalBytes < 16) throw new CaptureFailure('FINALIZE_FAILED');
    const head: ArrayBuffer = await this.readAt(0, Math.min(32, totalBytes)), view: DataView = new DataView(head);
    if (view.getUint32(4, false) !== 0x66747970 || view.getUint32(0, false) < 16 || view.getUint32(0, false) > totalBytes) throw new CaptureFailure('FINALIZE_FAILED');
    const md: cryptoFramework.Md = cryptoFramework.createMd('SHA256');
    for (let offset: number = 0; offset < totalBytes; offset += MEDIA_CHUNK_BYTES) {
      this.live();
      const block: ArrayBuffer = await this.readAt(offset, Math.min(MEDIA_CHUNK_BYTES, totalBytes - offset));
      await md.update({ data: new Uint8Array(block) });
    }
    const digest: cryptoFramework.DataBlob = await md.digest();
    this.live();
    this.result = { totalBytes: totalBytes, totalChunks: Math.ceil(totalBytes / MEDIA_CHUNK_BYTES),
      sha256: Array.from(digest.data).map((n: number): string => n.toString(16).padStart(2, '0')).join(''),
      mime: 'audio/mp4', durationMs: Math.max(1, Math.min(this.maxMs, this.ended - this.began)) };
    return this.result;
  }

  private async readAt(offset: number, length: number): Promise<ArrayBuffer> {
    this.live();
    // Fresh read-only fd: offset starts at zero for both first reads and retries.
    const file: fs.File = fs.openSync(this.path, fs.OpenMode.READ_ONLY);
    try {
      const buffer: ArrayBuffer = new ArrayBuffer(length);
      if (fs.readSync(file.fd, buffer, { offset: offset, length: length }) !== length) throw new CaptureFailure('READ_FAILED');
      return buffer;
    } finally { fs.closeSync(file.fd); }
  }

  async read(index: number): Promise<ArrayBuffer> {
    const result: RecordedMedia | undefined = this.result;
    if (result === undefined || !Number.isInteger(index) || index < 0 || index >= result.totalChunks) throw new CaptureFailure('READ_FAILED');
    const offset: number = index * MEDIA_CHUNK_BYTES;
    return this.readAt(offset, Math.min(MEDIA_CHUNK_BYTES, result.totalBytes - offset));
  }

  private removeRouteListener(): void {
    if (this.routing !== undefined) { this.routing.off('deviceChange', this.routeChanged); this.routing = undefined; }
  }

  dispose(): Promise<void> {
    this.cancelled = true;
    if (this.cleanup === undefined) this.cleanup = this.cleanAfterPending().catch((error: Error) => {
      this.cleanup = undefined; throw error;
    });
    return this.cleanup;
  }

  private async cleanAfterPending(): Promise<void> {
    // Do not declare cleanup complete while create/prepare/finalize may still
    // acquire a recorder, fd or file. Late completions only reach this cleanup.
    if (this.starting !== undefined) { try { await this.starting; } catch { /* Reclaim partial start. */ } }
    if (this.finishing !== undefined) { try { await this.finishing; } catch { /* Reclaim partial finalize. */ } }
    this.ending = true;
    this.removeRouteListener();
    let failed: boolean = false;
    const recorder: media.AVRecorder | undefined = this.recorder;
    if (recorder !== undefined) {
      try { if (recorder.state === 'started' || recorder.state === 'paused') await recorder.stop(); } catch { /* Release still required. */ }
      try { await recorder.release(); this.recorder = undefined; } catch { failed = true; }
    }
    if (this.file !== undefined) { try { fs.closeSync(this.file.fd); this.file = undefined; } catch { failed = true; } }
    if (this.path !== '') { try { if (fs.accessSync(this.path)) fs.unlinkSync(this.path); this.path = ''; } catch { failed = true; } }
    this.result = undefined;
    if (failed) throw new CaptureFailure('WRITE_FAILED');
  }
}
