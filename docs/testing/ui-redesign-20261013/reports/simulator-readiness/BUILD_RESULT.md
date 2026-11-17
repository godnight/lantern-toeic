# Current final result: 2026-10-13 10:10 UTC

See [FINAL_NATIVE_RESULT.md](FINAL_NATIVE_RESULT.md) for the final frozen HAP d10202ec9ffc908e15199d8917cc270214d36b351161d90403a786faa604f573, 44,292,998 bytes, 1,229 source inputs / 1,071 resources. Official preserve-data upgrade and initial/cold AA smoke passed on the owned new QA instance, with two masked 404s per launch and no native interaction acceptance.

The following is the retained historical archive; its earlier current-status statements describe their recorded stages.

# 改版 Harmony 隔离构建阶段结果

当前协调状态：09:03 HAP/proof 已降为历史候选。root 因后续独立终审的 owner-key unmount 未保存 Blob 及其他 P2 问题继续改源，须等待新的明确冻结再构建。下面的 SDK/输入证明只对各自记录时刻成立。该历史候选已在全新独立 QA 实例首次安装、启动及冷启，验证官方 CLI 通道可用；两个子资源 404 仍待查，不能计最终 UI 验收。新实例与原生 smoke 证据见 SIMULATOR_CLI_QA.md。本链路没有待审批请求或签名/系统安全变更。

2026-10-13。本轮实际完成未签名 HAP 编译与资源核对，没有操作任何模拟器/手机、读取签名或写生产 harmony/rawfile。07:40、07:50 两包保留为阶段快照；收到 root 明确源冻结后，最后一次重建和独立源码/资源复核均通过，见下节。

## 历史冻结结果（09:03，IV05/C09/C10）

全新 ASCII staging：C:\Users\ADMINI~1\AppData\Local\Temp\lantern-ui-v11-beyeqowt。证据目录：build-lantern-ui-v11-beyeqowt。

- HAP：lantern-ui-v11-unsigned-local-only.hap，44,282,830 字节。
- HAP SHA-256：1fa43622e1c740d76a943889de69b9778d5466dc0892f0be3be7765655cccb8a。
- 1,071 项 web 资源实际字节和 SHA-256 全部一致；SDK CompileArkTS/PackageHap 实际执行，33 个任务执行，build exit 0。
- 2026-10-13 09:03:26 UTC 独立重查完整构建输入：1,228 个文件，新增/缺失/变更均为空。比旧 1,278 文件少是输入范围排除了文档/测试夹具，不能写成文件丢失。
- source manifest SHA-256：9ab3644d25288c954f3c5f7e44ddddb1378af55b57163e1bf33b16f1ea80f5d9。
- web manifest SHA-256：970336a9e187baabcff25a195826e2f0d82caf621c2cc4434dd073c98ef16c0c。

范围精确定义见 SOURCE_SCOPE.md 和 source-manifest.json 的 scope。根 README、docs、tests、reports 以及参考说明文档不纳入应用输入证明；public 实际随包发出的许可/署名资产全部保留。根依赖/构建配置仍固定。root 后续更新交付文档或测试报告不使本项 runtime/build-input proof 失效。

身份：com.lantern.toeic，0.3.3 / 20009，debug，HarmonyOS SDK 26.0.0.105，min/target API 12，未签名。未改变原生身份、发布版本或用户数据。

实际日志：sdk-build.stdout.log、sdk-build.stderr.log。校验：hap-integrity.json、final-freeze-proof.json；源与资产：source-manifest.json、web-bundle-manifest.json；整体结果：result.json。本结果是构建和完整性通过，不是 ArkWeb、安装、签名或真机验收通过。

## 历史冻结结果（08:19，已替换为候选）

全新 ASCII staging：C:\Users\ADMINI~1\AppData\Local\Temp\lantern-ui-v11-f2mk_hkd。证据目录：build-lantern-ui-v11-f2mk_hkd。

- HAP：lantern-ui-v11-unsigned-local-only.hap，44,280,739 字节。
- HAP SHA-256：440065d9a0c789153c8a12714dee10b75702f1603395662a625881e61330e618。
- 1,071 项 web 资源逐字节和 SHA-256 核对通过；原生 CompileArkTS/PackageHap 与 33 个任务实际执行，SDK build exit 0。
- 2026-10-13 08:19:19 UTC 独立重查 1,278 个源文件的完整路径集合和 SHA：新增/缺失/变更均为空。该证明仅绑定本次冻结，后续改源须重新核对。
- source manifest SHA-256：5c834e009fb89ba1ffcce84c672e444e2d32066364ddc77a70a678a4966fb4e3。
- web manifest SHA-256：4dac338048622b2cc62957792a01d19b28e68abf08ef7addf080733ef6d6caa9。

身份核对：com.lantern.toeic，0.3.3 / 20009，debug，HarmonyOS SDK 26.0.0.105，min/target API 12，未签名。未改生产发布版本、schema、原生身份或用户数据。

本次独立 proof 是 final-freeze-proof.json，另有 result.json、source-manifest.json、web-bundle-manifest.json、hap-integrity.json、sdk-build.stdout.log 和 sdk-build.stderr.log。没有设备 UI/安装/签名验证。此工作线没有发起或收到权限审批，不能将其他 manager 审批 ID 归因于本次构建。

## 成功证据

| 快照 | 07:40 UTC | 07:50 UTC |
| --- | --- | --- |
| 本机证据目录 | build-lantern-ui-v11-7a40d6ay | build-lantern-ui-v11-qxywxjpx |
| HAP 字节 | 44,278,323 | 44,279,773 |
| HAP SHA-256 | 50c67bfe56e1922cc033711826d6faa7d09fb80f7c26938d80168abbfce68a1b | b128ca0d82093b05e82dba6e2ca9e18adbc38afcbb35c9e2219cd34f7b36759f |
| 核对 web 资源 | 1,071 | 1,071 |
| 编译后与 root 源快照比较 | app/redesign.css、app/study-app.tsx 已变化 | 完成时 1,278 个源文件均相同；随后 root 仍在修订 |

每个目录都有 result.json、source-manifest.json、web-bundle-manifest.json、hap-integrity.json 和本地 HAP。第二个目录的 sdk-build.stdout.log 显示 CompileArkTS/PackageHap、33 个任务实际执行，BUILD SUCCESSFUL；sdk-build.stderr.log 明确 No signingConfig。结果不能扩写为安装或原生 UI 通过。

两包身份保持：com.lantern.toeic，0.3.3 / 20009，debug，HarmonyOS SDK 26.0.0.105，min/target API 12。没有为设计验收生成发布版本、改 schema 或构造数据迁移。

07:50 源 manifest SHA-256：2623ab5aa4f392ee12b8a02fffa424e54d1a66bb48eb6cbda3029d54b7053738。web manifest SHA-256：6a9894b2da5b4b7eb2a0e87265b5eb2ac231aaff7860c09f8929bc388058118e。以上仅绑定该冻结快照，不能绑定后续编辑。

## 隔离方式和失败闭环

- 在全新 C:\Users\ADMINI~1\AppData\Local\Temp\lantern-ui-v11-* 中复制当前工作树，前后逐文件 SHA 检查；依赖只读复用根锁定 node_modules junction。Vite native config loader 和 cacheDir 位于 staging，未复用旧 mobile/dist。
- 共享前端、1,015 个离线音频、web sync/check 都在 staging 完成。未写生产 Harmony rawfile。
- 仅在 staging 删除 product compileSdkVersion，让 Windows Studio 选择 SDK 26；compatible/target API 12 和 unsigned signingConfigs=[] 保持。
- 官方 Hvigor 实现支持 HVIGOR_USER_HOME；进程级设置至 staging，未修改 HOME、用户持久配置或全局 .hvigor。
- 空隔离缓存尝试下载 pnpm 被网络拒绝，改为只读复制已有 pnpm 10.28.2 工具包。本轮没有下载安装新工具或签名。

首次复制遗漏 vendor 和 release-manifest 导致前端失败，保存在 build-lantern-ui-v11-s0yl_m23。补全快照后原生构建先遇到嵌套 WindowsPowerShell 5 的 Temp 工作目录权限问题，再遇到默认全局 .hvigor 写入拒绝和空缓存网络拒绝；失败日志保留在 07:40 目录，没有改为通过。受支持 PowerShell 7、官方缓存隔离和现有 pnpm 种子解决后编译成功。build-isolated.py 已纳入这些可重复步骤。

仅对每次新 staging 的官方清单确认过的自有 Hvigor daemon 做项目级收尾，未使用 stop-daemon-all、未停止实例或其他任务。原生 UI 能力判断和限制见 DEBUGGER_SCOPE.md：当前源码默认关闭 ArkWeb 调试，CUA 没有任意 ArkWeb/CDP attach；本轮没有 HDC UI 绕过。

## 后续

最终冻结构建已完成，不再重复重建。未完成的设备项包括实际 ArkWeb、系统选择器、原生 Back、录音/回听、前后台及 Pura X Max 内外屏，不以 Chrome nativeMode 或 HAP 编译替代。若之后必须改生产源，由 root 协调新的冻结边界。
