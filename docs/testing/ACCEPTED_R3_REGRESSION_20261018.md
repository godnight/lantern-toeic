# 已验收 r3 浏览器回归适配（2026-10-18）

基线为 `v0.3.4-accepted-r3` / `3daf2d108b2a48c67e1603e93ec2839eb636f627` / `P2-20261014-r3-f5ab766451ef` / `0.3.4 / 20012`。冻结 tag 与原 checkout 不变。本轮只修改测试脚本，不改应用、素材、依赖、构建身份或版本号。

GitHub 原 tag 对应的 Core run `39051471165` 在旧“主导航 → 学习书库”定位器超时；Harmony run `39051474991` 通过。此处记录的是后续隔离 checkout 的本地回归，不把原失败 run 改称成功，也不等同后续合并提交的远端 CI。

## 测试适配依据

| 原断言目标 | 当前批准界面及测试方式 |
|---|---|
| 主导航、训练之境、学习书库 | 390px 使用精确可访问名称“手机主导航”，入口为“练习”“资料”；桌面主题测试使用“桌面主导航” |
| 单词页旧入口与弹窗 | “单词 → 浏览全部词条、旧词卡与收藏备份”，保留真实文件选择器、释义/IPA/词源/许可、收藏、词卡评分、下载及重复恢复断言；新版详情是页内 article |
| 进入词库即加载词典 | 场景浏览不读取通用词典；主动英汉查询触发读取。故障用例先输入 reservation，再注入错误文件，验证原场景结果仍可用、明确重试成功 |
| 模考旧退出按钮、结果标题 | 改为“返回学习”“保存并退出”及两步强制退出；整卷正确数、漏答数从实际成绩区验证，原数据库/首答/复测/截止时间断言保留 |
| atlas 五地图、切色不换地图、动效开关 | 已被批准的 Workspace 六导航、四套外观、静态完整场景替代。旧套件全文保留在 `tests/browser/theme-atlas-legacy.cjs`，不作为当前 UI 的通过项。当前入口覆盖 4 宽度 × 4 主题 × 6 路由、配色/持久化、图像真实像素/完整比例、可点击范围、键盘选择、练习弹窗、系统减少动态及学习事实不变 |
| Web 主题 fixture 只导入旧 globals | 同真实 `app/layout.tsx` / mobile 入口导入 `redesign.css`；合成账号返回 `hasProfile: true`，检查真实 UI 只发送 owner 绑定的 `theme` 操作且不附带整个 profile |

没有跳过失败断言、把产品错误标为 expected、改变题包答案或放松截止/备份约束。旧 UI 已删除的场景动效不再伪称为当前可测功能。

## 本地执行结果

Windows Node `24.13.1`、Playwright `1.62.1`、本机 Chrome；仅新建隔离浏览器 context 和合成数据。使用根锁定依赖现有安装，不在共享依赖上执行 `npm ci`；冻结与本 checkout 的 lockfile Git blob 均为 `58937fe68faddf1a6cc06c5db9297572e7914ef5`。逐项执行 Core setup 的检查命令，另加第二阶段现有单元测试。

| 检查 | 结果 |
|---|---|
| typecheck、content、art | PASS |
| `npm run test:study` | 479 / 479 |
| `node --test tests/build-timeout.test.cjs` | 15 / 15 |
| Web 与 mobile 生产构建 | PASS |
| `node --test tests/*.test.mjs` | 34 / 34 |
| Python `test_release_*.py` | 22 / 22 |
| `node --test tests/phase2-*.test.cjs` | 167 / 167 |
| 真实打印保护 PDF → Poppler → 7 页 JPEG → 200 题合成包 | PASS |
| 完整模考浏览器（含 PDF 页码、图片放大四角、音轨时长） | 26 / 26 |
| 词库浏览器 | 14 / 14 |
| 共享原生前端主题浏览器 | 57 / 57 |
| Web 合成账号主题浏览器 | 57 / 57 |
| 全量 SQL 迁移到空 SQLite 内存库 | PASS，非生产迁移 |

PDF 使用现有私有工具目录中的完整 Poppler `26.07.0` 与 ReportLab `4.4.9`。首次宿主 Python 缺 ReportLab、默认工具路径缺 pdfdetach 的基础设施失败已记录，改用现有完整运行时和绝对工具路径后转换通过，未绕过 PDF 权限/附件检查。

证据位于本机 `D:\zzl\托业学习\vocab-work\accepted-regression-20261018\evidence`；首次失败与后续成功目录均保留。成功报告 SHA-256：

| 文件 | SHA-256 |
|---|---|
| `exam-4/result.json` | `95003a5b7c065f7826bcef825d7157c1fbcf3d99814f3493c1e8195f0ad31c4a` |
| `dictionary-3/result.json` | `9d85ccd67a61e7a2f721a80975e70bbfe8db8564014cb3160bd1c889e0192484` |
| `theme-native-5/result.json` | `cfb8620fb5a4387ca2490f1594641d62ea3b85d4187e731fe1215efceed6c1da` |
| `theme-web-2/result.json` | `a6a0ccd8064d3c6f453730619f988130f1626c6d2c06131a6dd68cd20804e48e` |

抽查了真实截图 `theme-native-5/hollow-320.png`、`paper-1440.png`：主题/导航/完整湖景呈现正确。所有场景截图均保留；这不是逐像素美术验收。

## 边界与接续

未访问线上站点、真实 D1/R2、真实学习资料、手机或麦克风。Web 账号为 context 内合成 API，不能称为登录/跨设备同步验收。浏览器静音 WAV 和快进时钟不能证明人耳听感或连续两小时耐久。没有修复或关闭录音 issue #47；录音由独立任务继续定位。

合并本轮测试适配后须在最终提交运行远端 Core/Harmony。不要移动已发布的验收 tag；后续产品修复、版本升级、签名 HAP、发布和真机安装分别记录。
