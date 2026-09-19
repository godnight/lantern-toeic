import { AbilityConstant, UIAbility, Want } from '@kit.AbilityKit';
import { window } from '@kit.ArkUI';
import { BusinessError } from '@kit.BasicServicesKit';

export default class EntryAbility extends UIAbility {
  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    AppStorage.setOrCreate('lanternForeground', false);
  }

  onWindowStageCreate(windowStage: window.WindowStage): void {
    try {
      windowStage.loadContent('pages/Index').catch((error: BusinessError) => {
        console.error('LANTERN page load failed: ' + error.code);
      });
    } catch (error) {
      console.error('LANTERN page load failed: ' + (error as BusinessError).code);
    }
  }

  onForeground(): void {
    AppStorage.setOrCreate('lanternForeground', true);
  }

  onBackground(): void {
    AppStorage.setOrCreate('lanternForeground', false);
  }

  onDestroy(): void {
    AppStorage.setOrCreate('lanternForeground', false);
  }
}
