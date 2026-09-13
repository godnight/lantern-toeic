# RFC 0001：原生平台收敛到 HarmonyOS

- 状态：已接受
- 决策日期：2026-09-13
- 决策者：项目所有者

## 背景

项目此前同时保留 Web/PWA、HarmonyOS、Android 与 iOS。项目所有者主要使用鸿蒙手机，并明确不再要求维护 Android/iOS App。继续同时升级三套原生工程会分散签名、权限、音频、升级与设备验收投入，也容易把“共享前端构建通过”误写成三个平台都已交付。

## 决策

1. 活跃客户端为 Web/PWA 与 HarmonyOS；HarmonyOS 是唯一主动维护的原生目标。
2. 按项目所有者后续“把Android/iOS的删掉”的要求，删除 `mobile/android`、`mobile/ios` 与 `mobile/capacitor.config.ts`；旧源码仅在Git历史保留，不重写历史。
3. `mobile/src`、`mobile/vite.config.ts` 和对应锁文件暂时保留。它们虽然沿用历史目录名，但仍是 `harmony/scripts/sync-web.mjs` 构建鸿蒙 ArkWeb 内置资源的输入；后续可在无行为变化的独立重构中改名。
4. 删除Android/iOS GitHub Actions、Capacitor依赖及`cap sync/open`脚本；共享网页只使用根目录依赖，初始化不再额外安装`mobile`依赖。
5. Web/PWA仍用于无需HAP即可从鸿蒙手机访问的在线形态；源码发布、Site部署、HAP编译签名与真机验收继续分开记录。

## 影响

- 新功能只需验证 Web/PWA、鸿蒙共享资源，以及有SDK时的HAP/真机路径。
- 历史Android APK和iOS模拟器结果仍可追溯，但不代表当前版本支持。
- 共享构建包版本随当前源码前进；当前源码树不再包含Android/iOS构建号或平台工程。

## 恢复其他平台

若将来恢复Android或iOS，必须由新RFC明确用户需求、维护人、工具链、签名、数据迁移和设备矩阵；不得仅重新打开CI就宣称恢复支持。
