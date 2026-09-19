import { common } from '@kit.AbilityKit';
import { webview } from '@kit.ArkWeb';
import { fileIo, fileUri, picker } from '@kit.CoreFileKit';
import { util } from '@kit.ArkTS';
import { BusinessError } from '@kit.BasicServicesKit';

const LOCAL_ORIGIN: string = 'https://lantern.local';

function allowedBlob(name: string, mime: string): boolean {
  const type: string = mime.toLowerCase().split(';')[0].trim();
  if (name === 'lantern-original-starter.json' || name === 'lantern-my-study-records.json') {
    return type === 'application/json';
  }
  if (name === 'lantern-weekly-review.md') return type === 'text/markdown';
  if (name === 'speaking-recording.m4a') return type === 'audio/mp4';
  if (name === 'speaking-recording.webm') return type === 'audio/webm';
  return false;
}

function bundledFile(url: string): string {
  for (const name of ['hollow-originals-v0.2.3.zip', 'silk-originals-v0.2.3.zip']) {
    if (url === LOCAL_ORIGIN + '/art-packs/' + name) return name;
  }
  return '';
}

class DownloadJob {
  item: webview.WebDownloadItem;
  guid: string;
  name: string;
  bundled: boolean;
  path: string = '';

  constructor(item: webview.WebDownloadItem, name: string, bundled: boolean) {
    this.item = item;
    this.guid = item.getGuid();
    this.name = name;
    this.bundled = bundled;
  }
}

// No JavaScript filesystem bridge. Only existing, allowlisted download actions are handled.
export class NativeDownloads {
  private context: () => common.UIAbilityContext;
  private canStart: () => boolean;
  private notify: (message: string) => void;
  private delegate: webview.WebDownloadDelegate = new webview.WebDownloadDelegate();
  private active: DownloadJob | undefined = undefined;

  constructor(context: () => common.UIAbilityContext, canStart: () => boolean,
    notify: (message: string) => void) {
    this.context = context;
    this.canStart = canStart;
    this.notify = notify;
    this.delegate.onBeforeDownload((item: webview.WebDownloadItem) => { this.begin(item); });
    this.delegate.onDownloadFinish((item: webview.WebDownloadItem) => { this.finish(item); });
    this.delegate.onDownloadFailed((item: webview.WebDownloadItem) => {
      const job: DownloadJob | undefined = this.active;
      if (job && job.guid === item.getGuid() && !job.bundled) {
        this.fail(job, '导出未完成，请重试');
      }
    });
  }

  attach(controller: webview.WebviewController): boolean {
    try {
      controller.setDownloadDelegate(this.delegate);
      return true;
    } catch (error) {
      console.error('LANTERN download attachment failed: ' + (error as BusinessError).code);
      this.notify('导出功能暂不可用，请重新打开应用后重试');
      return false;
    }
  }

  private cancelItem(item: webview.WebDownloadItem): void {
    try { item.cancel(); } catch { /* A finished/cancelled task may already be gone. */ }
  }

  private removePartial(job: DownloadJob): void {
    // The path is created below from the OS download directory and our random filename.
    // Never delete getFullPath(): the engine may report an unrelated fallback location.
    if (job.path === '') return;
    try { fileIo.unlinkSync(job.path); } catch { /* Missing partial output needs no cleanup. */ }
  }

  invalidate(): void {
    const job: DownloadJob | undefined = this.active;
    this.active = undefined;
    if (job) {
      this.cancelItem(job.item);
      this.removePartial(job);
    }
  }

  private fail(job: DownloadJob, message: string): void {
    if (this.active !== job) return;
    this.invalidate();
    this.notify(message);
  }

  private async begin(item: webview.WebDownloadItem): Promise<void> {
    const url: string = item.getUrl();
    const asset: string = bundledFile(url);
    const name: string = asset !== '' ? asset : item.getSuggestedFileName();
    const localBlob: boolean = url.startsWith('blob:' + LOCAL_ORIGIN + '/') &&
      allowedBlob(name, item.getMimeType());
    if (!this.canStart() || (!localBlob && asset === '') || this.active) {
      this.cancelItem(item);
      this.notify(this.active ? '已有文件正在导出，请稍候' : '暂不支持导出这个文件');
      return;
    }
    const job: DownloadJob = new DownloadJob(item, name, asset !== '');
    this.active = job;
    // Own packaged downloads before awaiting the directory: engine failures must not cancel the copy.
    if (job.bundled) this.cancelItem(item);
    try {
      const viewPicker: picker.DocumentViewPicker = new picker.DocumentViewPicker(this.context());
      const uris: string[] = await viewPicker.save({ pickerMode: picker.DocumentPickerMode.DOWNLOAD });
      if (this.active !== job) return;
      if (!this.canStart() || uris.length !== 1 || !uris[0].startsWith('file://')) {
        this.fail(job, '无法取得下载目录，请重试');
        return;
      }
      const directory: string = new fileUri.FileUri(uris[0]).path.replace(/\/$/, '');
      if (!directory.startsWith('/') || directory.split('/').some((part: string) => part === '..') ||
        directory.includes('\u0000')) {
        this.fail(job, '下载目录不可用');
        return;
      }
      const dot: number = name.lastIndexOf('.');
      job.path = directory + '/' + name.substring(0, dot) + '-' + util.generateRandomUUID() + name.substring(dot);
      if (fileIo.accessSync(job.path)) {
        // Do not remove an existing file, even in the unlikely event of a UUID collision.
        job.path = '';
        this.fail(job, '文件名冲突，请重新导出');
        return;
      }
      if (job.bundled) {
        // Packaged assets are read directly: downloading lantern.local over the network cannot work.
        const data: Uint8Array = await this.context().resourceManager.getRawFileContent('web/art-packs/' + name);
        if (this.active !== job) return;
        const file: fileIo.File = fileIo.openSync(job.path, fileIo.OpenMode.CREATE | fileIo.OpenMode.WRITE_ONLY);
        try {
          const buffer: ArrayBuffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
          let offset: number = 0;
          while (offset < buffer.byteLength) {
            const written: number = fileIo.writeSync(file.fd, buffer.slice(offset));
            if (written <= 0) throw new Error('Incomplete file write');
            offset += written;
          }
        } finally { fileIo.closeSync(file); }
        this.complete(job, data.byteLength);
      } else {
        item.start(job.path);
      }
    } catch {
      this.fail(job, '导出失败，请检查可用空间后重试');
    }
  }

  private finish(item: webview.WebDownloadItem): void {
    const job: DownloadJob | undefined = this.active;
    if (!job || job.bundled || job.guid !== item.getGuid()) return;
    try {
      if (job.path === '' || item.getFullPath() !== job.path) {
        this.fail(job, '文件未保存到下载目录，请重试');
        return;
      }
      this.complete(job, item.getReceivedBytes());
    } catch { this.fail(job, '无法确认导出文件，请重试'); }
  }

  private complete(job: DownloadJob, bytes: number): void {
    if (this.active !== job) return;
    try {
      const stat: fileIo.Stat = fileIo.statSync(job.path);
      if (!stat.isFile() || bytes <= 0 || stat.size !== bytes) {
        this.fail(job, '导出文件不完整，请重试');
        return;
      }
      this.active = undefined;
      this.notify('已保存到文件管理器的下载目录 · com.lantern.toeic');
    } catch { this.fail(job, '无法确认导出文件，请重试'); }
  }
}
