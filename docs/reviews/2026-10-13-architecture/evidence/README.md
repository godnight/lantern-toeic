# 脱敏证据与重跑说明

没有私人题本/答案、学习备份、录音、手机号、设备标识、密钥、签名或完整聊天。原tracked文件保护hash保存在本机scratch，仅归档比较结果，不复制运行时凭据。

| 文件 | 证据含义 |
|---|---|
| [data-security-probes.cjs](data-security-probes.cjs) / [log](data-security-probes.log) | 实际TS API+内存SQLite/R2、合成hook；录音换字节、不同owner假ack、first标签竞态、非法日期及坏snapshot共5组。exit0表示缺陷断言成立 |
| [native-audio-abort-probe.cjs](native-audio-abort-probe.cjs) / [log](native-audio-abort-probe.log) | 实际putAudio函数+合成abort-only事件，Promise未收敛；不是真实IndexedDB/ArkWeb复验 |
| [test-study.log](test-study.log) | 本轮root `npm.cmd run test:study` 335/335，0fail/skip；不会证明线上/设备全流程 |
| [typecheck.log](typecheck.log) | tsc --noEmit --incremental false exit0；空日志是正常成功，结果同时记录在验证文件 |
| [reviewer-manifest.json](reviewer-manifest.json) | 三份独立原稿与归档字节一致；probe仅适配默认根路径，不改变合成断言 |
| [baseline-metadata.json](baseline-metadata.json) | 本地源树、PR堆叠及已有Sites版本/部署的脱敏只读元数据 |
| [archive-validation.json](archive-validation.json) | 源码保护、归档文件/链接/代码引用和证据重跑结果 |

从本repo根目录，在既有根依赖及Node v24.13.1下可运行：

```powershell
node docs/reviews/2026-10-13-architecture/evidence/data-security-probes.cjs
node docs/reviews/2026-10-13-architecture/evidence/native-audio-abort-probe.cjs
```

probe默认向上定位本repo；第一份也支持 `LANTERN_REVIEW_ROOT`，第二份支持位置参数repo路径。它们不打开任何生产D1/R2、浏览器/设备数据；SQLite为内存实例，IndexedDB/React/R2都是受控合成替身。第一份需要Node内置node:sqlite，本轮环境v24.13.1，不以项目最低Node22.13保证probe可用。

本轮另跑内容/素材结构检查通过；网络reachability脚本23项均TypeError/exit1，未得到HTTP判断结果，不将其当失效链接证据。它生成ignored `reports/resource-links.json`（HTTP诊断，不是用户数据或生产源码）。未构建、未安装依赖、未操作真实设备或发布。
