# 鸿蒙离线 HAP 编译记录

核查日期：2026-09-15。任务分支：`feat/harmony-offline-hap`。本记录只把实际执行过的层级写为通过。

后续 `fix/harmony-native-exports` 增加下载目录导出，实际编译产物为 14,986,806 字节，SHA-256 `f12c9a2e0e7da1c8c82adad5b0006a6693091af3bfc33cfd7bba1ebad50d4773`。共享资源保持195项。8项新增源码回归通过，API 12 的 Download Picker 与 ArkWeb 下载代理经 API 18 SDK 编译通过；签名、文件管理器可见性和手机运行仍待验收。

实现参考官方 [API 12 下载指南](https://github.com/openharmony/docs/blob/OpenHarmony-5.0.0-Release/zh-cn/application-dev/web/web-download.md) 与 [保存用户文件](https://github.com/openharmony/docs/blob/OpenHarmony-5.0.0-Release/zh-cn/application-dev/file-management/save-user-file.md)。只指定本地下载目录，不引入任意文件写入桥；已知 rawfile 素材直接复制，避免请求虚拟域名的网络服务器。下文保留 PR #24 首次完整离线音频包的编译记录。

## 环境与来源

- Windows 11 中已有 WSL Ubuntu 24.04，使用 Linux x64 工具链编译；Windows 原生 DevEco/模拟器尚未配置。
- [华为官方公开 CLT 5.1.0 目录](https://repo.huaweicloud.com/harmonyos/ohpm/5.1.0/) 中的 `commandline-tools-linux-x64-5.1.0.840.zip`，2,153,496,473 字节。
- ZIP SHA-256：`1dcefa4741dc289277560b2802040e0c45b433898d8db453d711d5376e0478f1`；已与官方同名 `.sha256` 比对后解压。
- 内含 HarmonyOS SDK 5.1.0.125 Release / API 18、Hvigor 5.18.5、OHPM 5.1.3 和 Node；Java 使用现有 OpenJDK 21.0.11。
- 未将 SDK、账号、私钥、证书或设备标识提交 Git。

## 编译修复与结果

1. Hvigor 拒绝含中文的工程路径。构建脚本改用全新 ASCII 临时目录，源码可继续放在中文目录。
2. 使用已安装 API 18 编译 SDK；目标及最低兼容级别仍为 API 12。包内 `compileSdkType` 为 `HarmonyOS`，不是仅通过 OpenHarmony 接口检查。
3. SDK 18 的 `onInterceptRequest` 注释允许返回 `null`，类型声明却未包含 `null`。仅在回调边界使用非空断言，保留实际返回 `null` 的透传行为，以免拦截录音 blob URL。
4. 从全新临时目录运行 `ohpm install --all`、`assembleHap --no-daemon` 成功，实际执行 `CompileArkTS`、`CompileResource` 和 `PackageHap`。
5. 生成 `entry-default-unsigned.hap`。日志虽包含 `SignHap` 任务完成，同时明确提示 `No signingConfig found for product default`，因此仍是未签名包。

内置音频加入后的产物为 14,966,474 字节，SHA-256 `fb05ffcafa83e579ccdedf0ada8c44a28bc31c0ced7d8380008d8b91b57ecd19`。包含 `ets/modules.abc` 和 195 项资源，逐项匹配源文件和清单。其中 153 段为本机合成的英语语音，覆盖 328 处播放引用；全部完成解码及非静音检查。ZIP 时间戳等构建元数据可能让重建后的 HAP 哈希改变；每次交付以同目录 `package-verification.json` 为准。

验证：48 项共享业务及生命周期测试、2 项工具检查回归、6 项包体验证回归、TypeScript 类型检查、Web生产构建及5项产物检查通过。新增播放回归覆盖切换互斥、后台暂停、退出后的迟到失败及错误反馈。CI 运行共享资源及构建辅助脚本检查，未安装原生 SDK，不能将 CI 的共享检查标为 HAP 编译。

## 尚待运行验证

尚未完成签名、模拟器或手机安装、断网冷启动、录音与重启回放、导出文件落盘。手机型号及 HarmonyOS 版本待用户提供。原生手机号登录与云同步不属于先交付离线包的前置，当前仍未启用。

鸿蒙入口已注册内置音频，听力、逐句回听和口语示范不再调用系统 `speechSynthesis`；构建会阻止缺失原文对应音频的包生成。音频来源见 `mobile/offline-audio/README.md`。实际 ArkWeb 解码、扬声器输出、录音及学习存储仍须在运行环境检验。
