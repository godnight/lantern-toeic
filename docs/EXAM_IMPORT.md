# 个人完整听读题包

入口：训练之境或学习书库 → 完整听读模考。Web 使用当前登录账号的本机空间；鸿蒙使用应用本机空间。题包、答案、音频和模考记录仅保存在当前浏览器/应用，不上传 D1、R2、GitHub 或其他账号。没有预装官方完整真题。

## 使用流程

1. 选择一份或多份完整题包 JSON；每份独立校验和保存。同 ID、同版本、同内容重复导入不会增加副本；改版须递增版本。
2. 打开题包，完成音频试听与图片解码预检，确认声音可听清、材料完整。
3. 开始后听力固定 45 分钟、阅读固定 75 分钟。不能提前进入阅读或返回听力；后台、退出和重启不暂停。恢复听力按已经过的时间定位，并记录中断。
4. 阅读阶段可确认提前交卷，到时自动交卷。只有保存成功才显示成绩、答案与解析；漏答按错误计。首次与复测保留为独立记录。
5. 题包首页导出完整备份，检查系统下载文件确实存在。备份包含私人题文、答案、音频与记录；不要公开分享。当前只能在同一记录范围恢复，不提供 Web 与鸿蒙跨账号迁移。

本机记录无法提供监考或可信防改时间。Part 用时包含后台驻留时间，不能当作有效学习时间。正确题数不套用通用公式换算为托业分数；仅在题包附有出处明确的该套参考表时显示参考区间。

## JSON 格式 v1

这是已整理的数字题包导入器，不是 PDF OCR。自有纸质书仍需先整理题文/图、音频和答案。正文与图片均支持；导入者须确认有权以该方式个人使用。官方公开原样 PDF 的个人下载许可不自动代表可拆题重排或公开传播。

| 字段 | 内容 |
| --- | --- |
| `kind` / `schemaVersion` | `lantern-toeic-exam` / `1` |
| `id` / `version` / `title` | 1–80 位字母数字下划线连字符 ID；正整数版本；标题 |
| `source` | `classification`、`title`、`rightsStatement`；可含 `publisher`、`reference` |
| `assets` | `{id,mime,base64}[]`；原始文件的标准 base64，不含 data URL 前缀 |
| `listeningAudioId` | 本套整场听力音频的素材 ID |
| `groups` | `{id,part,questionNumbers,passages,imageIds}[]` |
| `questions` | `{number,part,groupId,prompt,choices,answer,explanation?}[]` |

`classification` 为 `official-past`、`official-practice`、`original` 或 `other`。官方分类还须填写出版社和具体版次/套号/来源。来源均由导入者声明，程序不会据此认证正版或再分发授权。所有文本按纯文字显示。

题号必须连续 1–200，Part 数量为 6/25/39/30/30/16/54；Part 2 三选项，其余四选项；`answer` 从 0 开始。Part 1/2 的口述题干可留空，口述选项可填 A/B/C/D 占位。每题恰好属于一个题组。

Part 1/2/5 每组 1 题，Part 3/4 每组 3 题，Part 6 每组 4 题和一份材料。Part 7 前 29 题为单篇材料（每组 2–4 题），后 25 题为多篇材料（每组 5 题，2–3 份材料）。`passages` 存完整纯文字；扫描图可用空字符串占据材料份数并引用图片。Part 1 必须有图，Part 6/7 必须有正文或图片。图片没有自动 OCR 无障碍文字，宜同时提供正文。

允许 PNG、JPEG、WebP、MP3、WAV；禁止外部资源、SVG、HTML、脚本和未引用素材。校验结构与可解码不能证明材料正确或完整，音频声音与题文答案对应仍需人工确认。音频不要求恰好 2700 秒，但与 45 分钟明显不同时会提示核对。

限额：单题包 JSON 96 MiB，音频 50 MiB，单图 6 MiB，解码素材合计 64 MiB，最多 100 素材；每账号 20 套、192 MiB 规范化 JSON 和 1000 次记录；完整备份 224 MiB。设备实际配额可能更小，低内存手机大文件尚未验收。失败事务不会留下半包或覆盖旧答题。

可选 `scoreRanges` 为 `{source,listening,reading}`，两科数组各项 `{minCorrect,maxCorrect,minScore,maxScore}` 连续覆盖 0–100；分数 5–495、步长 5、单调。仅填写该套材料提供的有出处参考表。

## 开发与测试

核心为 `lib/exam-model.ts`、`lib/exam-storage.ts`，UI 为 `app/learn/mock-exam.tsx`、`lib/exam-ui.ts`。独立 IndexedDB `lantern-private-exams-v1`；答题只读取不含大音频的目录，事务完成后才提示保存。不要用清空整库来处理恢复错误。

执行 `npm run test:exams`。浏览器回归先执行 `npm --prefix mobile run build`，安装 Playwright Chromium 后运行 `npm run test:browser`；使用专用本机端口 4175 和全新上下文，报告默认在系统临时目录。CI 每个 PR 和 Release 自动执行。`tests/fixtures/synthetic-exam.cjs` 仅供自动化控制变量，不含真实试卷，不得复制到 public、产品题库或发布附件冒充真题。开发测试与浏览器、模拟器、真机和两小时媒体验收分别记录。
