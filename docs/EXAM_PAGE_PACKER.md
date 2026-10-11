# 从本机 PDF 制作个人题包

这个开发工具将已核对的原卷 PDF 页面转为图片，连同配套音频、200 题答案和题组映射，生成 v0.3.0 已支持的 JSON 题包。正文仍在原页上显示，作答使用 A/B/C/D 答题卡。它不做 OCR、不生成试题、不猜答案，也不下载或上传材料。

先准备有权以此方式个人使用的完整题本、匹配的整场听力 MP3/WAV、答案及书名/版本/套号。把它们与 `recipe.json` 放入单独的私人文件夹；不要放入 Git 仓库、网页 `public`、题库 `content` 或鸿蒙内置资源目录。转换工具的存在不等于已经取得完整真题。

## 使用

安装仓库锁定依赖（`npm ci`），以及官方来源的 Poppler 工具 `pdfinfo`、`pdftoppm`、`pdfdetach`。Node 使用仓库要求的 22.13+。工具仅在电脑本机运行；手机仍选择生成的 `exam.json` 导入。

```text
npm run exam:pack -- --recipe /private/materials/recipe.json
```

默认在材料目录中创建新的 `packed-<id>-v<version>` 目录，内含 `exam.json` 和 `mapping-report.json`。可用 `--out-dir` 指定材料目录内的新目录；已有目录不会被覆盖。Poppler 不在 PATH 时用 `--pdfinfo`、`--pdftoppm`、`--pdfdetach` 指定实际可执行文件。没有自动安装软件或下载依赖的行为。

Windows 建议将完整 Poppler 分发目录放在仅含 ASCII 字符的工具路径下，并保留其配套资源。本次验证中，中文工具路径下的渲染进程虽成功退出，页面却缺少日文字形；同版工具移至 ASCII 路径后恢复。退出码或生成了图片不能代替现有的页面核对。

默认 192 DPI、JPEG 质量 90；`--dpi` 可设 72–200。原页过大、超出题包存储限制或不可解析时会失败，不会默默删页或降质。低 DPI 不一定能读清小字，应在 App 放大后核对。

## 支持的 PDF

接受未加密 PDF，也接受无需输入密码即可由 `pdfinfo` 正常读取、权限记录完整且明确为 `print:yes` 的权限加密 PDF。后者可保留禁止复制或修改等限制；工具只渲染允许打印的页面，不提供密码参数，不重写或移除原文件保护。报告保留 `encrypted:true`，并记录 `printingAllowed:true`；源文件 SHA 核对和只读快照规则不变。

需要输入密码、禁止打印、权限未知或元数据含歧义的文件会被拒绝；关键字段缺失或重复、JavaScript、表单和附件检查仍保持原有拒绝规则。允许打印不等于取得公开再分发授权，材料仍按前述个人使用范围保存在私人目录。

## 配方字段

这是给整理者/Codex 使用的本机配方，不要求学习者手写 200 个 base64 图片对象。真实题组、页码和答案仍需对照材料确认。

| 字段 | 含义 |
| --- | --- |
| `kind` / `schemaVersion` | `lantern-exam-page-recipe` / `1` |
| `exam` | `id`、`version`、`title`、`source`，沿用[题包格式](EXAM_IMPORT.md) |
| `documents` | `{id,file}[]`，`file` 为配方目录内的 PDF 相对路径 |
| `audioFile` | 同目录内整场 MP3/WAV 的相对路径 |
| `answers` | 恰好 200 个大写 A/B/C/D，按题号排列；Part 2 只能 A/B/C |
| `groups` | `{id,part,questionNumbers,passageCount,pages}[]` |
| `pages` | `{documentId,page}[]`，页码从 PDF 文件的第 1 页开始，可能不同于印刷页码 |
| `pageReview` | `{reviewed:true,excludedPages:[{documentId,page}]}`，明确排除答案、解析等页 |
| `audioReviewed` | `true` 表示整理者已核对题本、答案和整场音轨属于同一套材料 |

`passageCount` 指材料篇数，不是 PDF 页数。Part 6 为 1；Part 7 单篇为 1，多篇为 2 或 3。一篇材料跨两页时，篇数仍为 1，`pages` 有两个引用。Part 1/3/4/5/6/7 必须引用原卷页面；Part 2 可以没有图片，直接依据整场音频作答。题号、题组及选项数量最终由 App 使用的同一个校验器检查。

`reviewed:true` 是整理者声明，不是软件认证。声明前应确认：所有引用页都没有答案/解析；听力引用页不含阅读部分；没有漏掉续页、图表或跨页文本；200 项答案与题号逐一对应；音轨完整且匹配该卷。工具能拒绝已声明排除页和听读共用页，但不能通过 PDF 语义自动识别漏标的答案页或错配音轨。

## 转换后的核对

1. 查看 `mapping-report.json`，逐页核对题号、题组、听读用途和哈希。报告不列出答案值或私人绝对路径，但仍应按私人材料保存。
2. 在 App 导入 JSON，完成图片和音频预检。打开首尾页与每种题组，点击图片放大；确认可以滚动看到四角、页脚和小字。
3. 先在专门的校对记录中检查题文/答案/音轨对应关系；正式基线使用没做过的另一套材料。软件不把人工确认转换成官方真实性或正式成绩认证。
4. 保留原始材料、配方和完整备份。不要把带答案和音频的 JSON 提交到 GitHub 或复制进通用 HAP/Web 构建包。

## 自动化边界

`npm run test:page-packer` 验证结构、路径、排除页、听读隔离和失败输出。CI 用自有合成 PDF 实际运行 Poppler，再在独立浏览器中导入生成题包，验证图片字节、放大滚动、题组和成绩。合成 PDF、短静音 WAV、受控计时均不能证明真实官方卷、真实听音或两小时真机运行。

权限加密兼容修正已在私人副本完成29项回归，并将自制、允许打印且无需输入密码的保护 PDF 经真实 Poppler 打包后运行既有22条浏览器流程，全部通过。未保护 fixture 的默认输出逐字节不变；本次记录不代表该修正已合并或其 CI 已通过，详见[测试记录](testing/EXAM_PAGE_PACKER_2026-10-11.md)。
