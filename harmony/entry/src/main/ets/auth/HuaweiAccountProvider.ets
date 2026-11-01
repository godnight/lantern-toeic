import { authentication } from '@kit.AccountKit';
import { common } from '@kit.AbilityKit';
import { BusinessError } from '@kit.BasicServicesKit';
import { cryptoFramework } from '@kit.CryptoArchitectureKit';

export interface HuaweiAuthorization {
  code?: string;
  failure?: string;
}

/** SDK credentials remain native memory only; never registered with ArkWeb. */
export class HuaweiAccountProvider {
  static available(): boolean {
    return canIUse('SystemCapability.AuthenticationServices.HuaweiID.Auth') &&
      canIUse('SystemCapability.Security.CryptoFramework.Rand');
  }

  async authorize(context: common.UIAbilityContext): Promise<HuaweiAuthorization> {
    try {
      if (!canIUse('SystemCapability.AuthenticationServices.HuaweiID.Auth') ||
        !canIUse('SystemCapability.Security.CryptoFramework.Rand')) return { failure: 'huawei-authorization-failed' };
      // 256 unpredictable bits, using only characters accepted by Account Kit state.
      const bytes: Uint8Array = (await cryptoFramework.createRandom().generateRandom(32)).data;
      let state: string = '';
      for (let index: number = 0; index < bytes.length; index++) state += bytes[index].toString(16).padStart(2, '0');
      if (state.length !== 64) return { failure: 'huawei-authorization-failed' };
      const request: authentication.LoginWithHuaweiIDRequest = new authentication.HuaweiIDProvider().createLoginWithHuaweiIDRequest();
      request.state = state;
      // No profile/mobile scopes and no unverified ID-token shortcut.
      const controller: authentication.AuthenticationController = new authentication.AuthenticationController(context);
      const response: authentication.LoginWithHuaweiIDResponse = await controller.executeRequest(request) as authentication.LoginWithHuaweiIDResponse;
      const code: string | undefined = response.data?.authorizationCode;
      if (response.state !== state || typeof code !== 'string' || code.length < 1 || code.length > 4096 || /[\u0000-\u0020\u007f]/.test(code)) {
        return { failure: 'huawei-authorization-failed' };
      }
      return { code: code };
    } catch (error) {
      const failure: BusinessError = error as BusinessError;
      return { failure: failure?.code === 1001502012 ? 'huawei-cancelled' : 'huawei-authorization-failed' };
    }
  }
}
