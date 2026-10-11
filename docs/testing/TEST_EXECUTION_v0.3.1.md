# v0.3.1 测试与发布门禁

日期：2026-10-11。版本 0.3.1 / HarmonyOS versionCode 20007。

本版修复完整音轨超出固定 45 分钟时提前结束的问题。验证设计、首次失败与修复回归见 [完整音轨验证](LISTENING_DURATION_2026-10-11.md)，兼容与时长边界见 [RFC 0006](../rfcs/0006-complete-listening-duration.md)。

## 已验证

- 模型、存储、UI 及打包器共 229 项，类型检查、Web/共享前端构建通过；Node 发布及构建契约 34 项通过。
- 实际 Chrome 26 条流程通过，含真正 45:53 静音媒体的时长预检、45 分钟后继续播放、冷启对时、新听力截止及 75 分钟阅读截止自动提交。
- 旧格式固定字节/SHA、原地数据库升级零行写入、混合备份及篡改拒绝均覆盖；这部分离线测试不代替 ArkWeb 升级验收。
- 功能提交 `39a97ff7bb5c740ef2bdd6078e02f59d52fcb692` 的 [Core](https://github.com/godnight/lantern-toeic/actions/runs/38123924647) 和 [Harmony](https://github.com/godnight/lantern-toeic/actions/runs/38123924611) 均成功。版本及文档变更后的最终提交另核对。
- 版本递增后重新生成 Web 与鸿蒙共享前端，34 项发布/构建契约通过。Windows SDK 26 的全新未签名工程实际编译成功（同一次构建等待首次同步后完成，没有重启重跑），生成 HAP 19,188,774 字节，SHA-256 `eb2b29f7236f9a049ce8f9ef04d91508555618618510296e6785e9b54ed8a830`；490 个 Web 资源逐字节一致，原生字节码存在，包内版本确为 0.3.1 / 20007，最低/目标仍为 API 12。

上述本机包由 SDK `26.0.0.105` 构建，用于模拟器验收。公开 Release 仍由固定 Linux CLT / SDK 18 工作流另行构建，不能用本机 HAP 的 SHA 代替其发布附件 SHA。

## 鸿蒙覆盖升级

专用 HarmonyOS 7 / API 26 内容模拟器从 v0.3.0 / 20006 经 `install -r` 覆盖至 v0.3.1 / 20007，没有卸载或清数据。升级前 B0、升级后 B1、正常退出/force-stop 后冷启 B2 均经 App 实际导出，并各接收两份稳定副本；三轮完整备份及副本逐字节相同：75,695,155 字节，SHA-256 `f62ee4c67f2af7c5133ea23dadeffcc1a8ab8d053d1cedb93fa2eebae627039a`。当前模型验证 1 套 HAU/0 考试，原包 75,695,046 字节及 SHA 保持不变。证据为私人 `native-upgrade/proof-B0-B1-B2.json`。

## 发布门禁与追溯

最终提交须再次通过 Core/Harmony；合并触发预发布工作流，重新检查、编译固定 SDK HAP、生成 Web/源码和校验文件，所有附件核验后才公开。公开运行记录、对应源码和实际附件摘要以 Release 的 `build-info.json`、`package-verification.json` 与 `SHA256SUMS.txt` 为准，本机包不冒充 CI 产物。Sites 发布单独核验。

## 验证边界

不占用物理手机，旧 Pura X Max 词库与录音测试不能用作本版模考真机通过。浏览器时钟推进不等于自然两小时运行；合成静音播放不等于人耳音质验收。升级验收时内容模拟器为 1 包 0 记录，因此只证明题包原地升级保留，不能扩大到旧活动考试迁移。私人题文、音频、签名和个人记录不进入发布附件。
