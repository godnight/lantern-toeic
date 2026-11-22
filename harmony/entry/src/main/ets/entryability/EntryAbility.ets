import { AbilityConstant, UIAbility, Want } from '@kit.AbilityKit';
import { window } from '@kit.ArkUI';
import { BusinessError } from '@kit.BasicServicesKit';
import { themeWindow } from '../theme/ThemeWindow';

export default class EntryAbility extends UIAbility {
  private stageGeneration: number = 0;
  private windowRetryTimer: number = -1;
  private stage: window.WindowStage | undefined = undefined;
  private contentReady: boolean = false;
  private windowBound: boolean = false;
  private foreground: boolean = false;

  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    AppStorage.setOrCreate('lanternForeground', false);
    themeWindow.setForeground(false);
  }

  onWindowStageCreate(windowStage: window.WindowStage): void {
    const generation: number = ++this.stageGeneration;
    if (this.windowRetryTimer !== -1) clearTimeout(this.windowRetryTimer);
    this.windowRetryTimer = -1;
    this.stage = windowStage;
    this.contentReady = false;
    this.windowBound = false;
    themeWindow.clearWindow();
    try {
      windowStage.loadContent('pages/Index').then(() => {
        if (generation !== this.stageGeneration) return;
        this.contentReady = true;
        this.bindReadyWindow(windowStage, generation, 0);
      }).catch((error: BusinessError) => {
        console.error('LANTERN page load failed: ' + error.code);
      });
    } catch (error) {
      console.error('LANTERN page load failed: ' + (error as BusinessError).code);
    }
  }

  private bindReadyWindow(stage: window.WindowStage, generation: number, attempt: number): void {
    if (generation !== this.stageGeneration || !this.contentReady || this.windowBound) return;
    try {
      // setWindowBackgroundColor is valid only after loadContent completes.
      themeWindow.setReadyWindow(stage.getMainWindowSync());
      this.windowBound = true;
    } catch {
      if (!this.foreground || this.windowRetryTimer !== -1) return;
      if (attempt >= 19) {
        console.warn('LANTERN main window is not ready for theme');
        return;
      }
      this.windowRetryTimer = setTimeout(() => {
        this.windowRetryTimer = -1;
        this.bindReadyWindow(stage, generation, attempt + 1);
      }, 100);
    }
  }

  onWindowStageDestroy(): void {
    this.stageGeneration++;
    if (this.windowRetryTimer !== -1) clearTimeout(this.windowRetryTimer);
    this.windowRetryTimer = -1;
    this.stage = undefined;
    this.contentReady = false;
    this.windowBound = false;
    themeWindow.clearWindow();
  }

  onForeground(): void {
    this.foreground = true;
    themeWindow.setForeground(true);
    AppStorage.setOrCreate('lanternForeground', true);
    if (this.contentReady && this.stage !== undefined && !this.windowBound) {
      this.bindReadyWindow(this.stage, this.stageGeneration, 0);
    }
  }

  onBackground(): void {
    this.foreground = false;
    AppStorage.setOrCreate('lanternForeground', false);
    themeWindow.setForeground(false);
    if (this.windowRetryTimer !== -1) clearTimeout(this.windowRetryTimer);
    this.windowRetryTimer = -1;
  }

  onDestroy(): void {
    AppStorage.setOrCreate('lanternForeground', false);
    this.stageGeneration++;
    if (this.windowRetryTimer !== -1) clearTimeout(this.windowRetryTimer);
    this.windowRetryTimer = -1;
    this.stage = undefined;
    this.contentReady = false;
    this.windowBound = false;
    this.foreground = false;
    themeWindow.setForeground(false);
    themeWindow.clearWindow();
  }
}
