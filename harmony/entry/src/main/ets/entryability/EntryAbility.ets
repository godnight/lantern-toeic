import { AbilityConstant, UIAbility, Want } from '@kit.AbilityKit';
import { window } from '@kit.ArkUI';

export default class EntryAbility extends UIAbility {
  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    AppStorage.setOrCreate('lanternForeground', false);
  }

  onWindowStageCreate(windowStage: window.WindowStage): void {
    windowStage.loadContent('pages/Index');
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
