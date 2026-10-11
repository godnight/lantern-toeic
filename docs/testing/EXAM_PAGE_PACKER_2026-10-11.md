# 本机 PDF 原页题包工具测试

执行日期：2026-10-11（Asia/Shanghai）。本轮新增开发工具、测试及文档，不改变 v0.3.0 App 运行代码、题包格式、版本号、已发布附件或 Site 部署。以下保留初版验证；同日权限加密 PDF 兼容修正的私人验证追加在文末。没有制作、上传或内置真实官方试卷题包。

## 设计与验证

目标是让已有完整 PDF、音轨、答案和题组映射可以整理为现有 App 接受的 JSON，保留原页，不用 OCR 重写试题。输入、临时快照与输出均留在本机私人目录；最后调用实际 `parseExamPackage`。

| 层次 | 实际执行与结果 |
| --- | --- |
| 单元与故障注入 | 新增 26 项通过：200题结构、Part边界、人工核对声明、路径/junction越界、同字节PDF别名、排除页、听读隔离、主动内容元数据、容量、实际子进程超时/字面参数、后期失败清理和输出竞争不覆盖 |
| 既有学习回归 | `test:study` 共 161 项通过，含上述 26 项；TypeScript 检查通过 |
| 实际 PDF 渲染 | ReportLab 4.4.9 生成原创 8 页控制材料；Poppler 26.07.0 实际检查并渲染 7 页，答案附录第8页未渲染；每图 1588×2246，192 DPI / JPEG质量90 |
| 模型与媒体链路 | 生成题包 3,240,434 B，媒体 2,398,130 B；浏览器核对源PDF、JSON、映射报告、JPEG与WAV的 SHA256，真实解码并从UI导入 |
| 实际浏览器 | Playwright 1.62.1 + 本机 Chrome，复用 v0.3.0 共享生产构建；22 个流程通过（原18 + 原页链路4），保留34张截图；页面错误、HTTP错误和外部请求均为0，专用4175服务已清理 |
| 图片与题组 | 320/390/768布局检查；320/390放大图片四角可滚动到达；第147题一篇两页、第176题两篇、第186题三篇映射正确；缩略页、跨页图及8pt测试文字人工查看未见漏页裁切 |
| 计时与成绩 | 受控时钟越过45分钟进入阅读并锁住听力；两道已知控制答案交卷显示正确2/200、漏答198，首次记录、两科和Part结果一致 |
| 独立审查 | 项目经理只读复审输入快照、映射、输出/清理和浏览器断言，未发现可复现的实质问题 |

## 遇到的问题与修正

捆绑 Poppler 只有 `pdfinfo`、`pdftoppm`，缺少 `pdfdetach`。首次实际转换明确失败，没有生成最终题包；随后在私人目录补齐同版完整工具，再转换、检查图片并执行完整浏览器回归。没有跳过附件检查或伪造成功返回。

完整 Windows 工具来源为 [oschwartz10612/poppler-windows v26.07.0-0](https://github.com/oschwartz10612/poppler-windows/releases/tag/v26.07.0-0)。下载 ZIP 42,202,938 B，SHA256 `a711b0563b06edc488583d28198b6734c5a494afbbd1b9d87d3d2866062fb7e2` 与 release asset digest 相同。它是 Windows 打包发行；没有修改 Codex 捆绑运行时。字体资源警告不当作已通过的通用字体兼容保证，真实材料仍须查看转换页。

## 可重复执行

安装锁定 Node 依赖、Poppler三项工具及测试用 `reportlab==4.4.9` 后，在新的私人测试目录执行：

```bash
python tests/fixtures/create-page-packer-fixture.py --out-dir /private/page-pack-qa
node scripts/pack-exam-pages.cjs --recipe /private/page-pack-qa/recipe.json
npm run test:study
npm --prefix mobile run build
LANTERN_PAGE_PACK_QA_DIR=/private/page-pack-qa npm run test:browser
```

Core 和 Release 工作流均加入实际 PDF 转换及4条后续浏览器流程；只上传测试报告和原创截图，不上传原始PDF、音频、私人JSON或备份。本次GitHub实际运行结论以本PR检查为准，不以本地通过代替CI成功。

## 证据与边界

本机报告 `vocab-work/page-pack-browser-qa-20261011/result.json`，转换目录 `vocab-work/exam-packer-live-qa-20261011-v2`，相对于私人工作区而非仓库。转换结果 JSON SHA256：`21297e4c1fc8d5f26197182aacbe3bf76fa5f7a38028ce088498cbf199bdbb92`。这些私人路径不是克隆仓库后必然存在的文件。

生成材料是明确标注的原创控制变量，不是可学习试卷。20秒静音只验证解码/播放器事件；加速时钟不等于两小时续航；Chrome窄屏不等于ArkWeb、触摸手势或Pura X Max验收。`reviewed:true`只记载整理者声明，不能自动识别漏标答案页、核对音轨或证明授权。完整可导入官方真题仍为0套；真实卷、大音频、低内存设备和新版本安装仍待验证。

## 同日补充：可打印权限加密 PDF

状态：修正已提交草稿[PR #34](https://github.com/godnight/lantern-toeic/pull/34)，基于PR #33分支，尚未合并main。提交 `407e81e92303f0f0b2f4697344125af89e9267dc` 的[Core运行38116263181](https://github.com/godnight/lantern-toeic/actions/runs/38116263181)已成功；实际job `114401642878` 日志确认201项学习/模型检查和22条浏览器流程通过，并执行带 `--printable-protected` 的原创PDF生成及真实Poppler转换。下表保留本机验证，GitHub CI结论与之分别记录。改动仅涉及本机打包工具、测试及文档，不改变App、题包格式或已发布版本。

后续取得的 IIBC 2020 官方模考题本可以无需输入密码正常读取，且明确允许打印，但旧解析器将所有 `Encrypted: yes` 文件一律拒绝，实际复现 `PDF_ACTIVE`。修正仅接受正常无密码调用返回的完整已知权限记录且 `print:yes` 的情况；报告保留 `encrypted:true` 和 `printingAllowed:true`。禁止打印、未知权限、重复或缺失关键字段、JavaScript、表单及附件仍拒绝。没有新增密码参数、重写或解除原件保护。

| 验证 | 实际结果与边界 |
| --- | --- |
| 源码回归 | 在原26项上新增3项行为检查；修正前27通过、2失败，修正后29/29通过，独立复跑同样通过。不是将两轮数量累加为覆盖数。 |
| 真实题本检查 | 实际 Poppler 读取42页、`encrypted:true`、`printingAllowed:true`、无JavaScript/表单，附件数为0；无密码参数渲染封面。原件SHA保持不变。这里只检查与渲染原件封面，没有生成真实题包或进行App导入。 |
| 字形缺失与复核 | 首次中文工具目录的渲染缺少日文，机械检查通过未被当作视觉通过；该失败证据保留。同版完整 Poppler 移至 ASCII 工具目录后，stderr为空，活动标题、日期和日文页脚经目视确认恢复。 |
| 原创保护 fixture | 可选 `--printable-protected` 使用空用户密码、仅用于QA的固定所有者密码，允许打印、禁止复制/修改/批注，生成新的8页原创PDF。此 fixture 使用128位RC4，不冒称复现真实IIBC原件的AES加密方式。 |
| 默认 fixture 保持 | 原生成器与私人副本分别生成默认未保护材料，PDF、WAV、recipe三份文件逐字节一致；保护模式不改变默认输出。 |
| 实际打包 | 无密码参数调用真实 Poppler，生成7张JPEG及200题JSON；报告保留保护/打印状态，源PDF前后SHA及报告摘要一致。使用当前实际 `parseExamPackage` 校验。 |
| 实际浏览器 | 私人packer产物复用既有共享生产构建和原浏览器runner，22/22通过、0失败；页面错误、HTTP错误、外部请求均为0，无清理错误，`previewStopped:true`，进程退出0。没有重新构建App或操作设备。 |
| 页面与行为 | 原页4项流程核对JPEG/WAV解码与字节、听读图片隔离、320/390布局及放大四角、一篇跨两页、阅读题组映射、听力截止锁定及两道合成答案判分；其余原流程验证导入、备份、考试与复测、未来时间和容量失败行为。截图抽查确认续页及放大后的右上标记可见，合成结果为正确2、未答198。 |
| 独立审查 | 私人提案经独立只读审查，未发现阻断；该结论不替代集成后对应提交的CI结果。 |

真实题本原件 SHA-256 为 `3ec59ca13a6c1147acddeefbb37f093d5bc29f41565faf98fe6fe6e049baf17e`，ASCII 工具路径封面渲染为816×1056、72,880字节；只核验允许的页面渲染，原件未修改。

原创保护 fixture 的源PDF SHA-256 为 `8362a564e61032c0cca3e6f7117967cb8623fca8be11eb7b1d645028631e859e`；生成JSON为3,240,434字节，SHA-256 `21297e4c1fc8d5f26197182aacbe3bf76fa5f7a38028ce088498cbf199bdbb92`。浏览器结果文件 SHA-256 为 `556c5f4ddfb1bc0152bd7f7e76350fa3da4ab86e1a0eb338f68cbaf60002aa26`。私人证据文件包括 `PROTECTED-FIXTURE-E2E.txt`、`protected-e2e-summary.json`、`real-printable-proof-ascii-tools.json`、默认fixture字节比较及浏览器报告；原始材料和渲染不进入公开仓库。

本补充使用原创控制材料与20秒静音。桌面Chrome及受控时钟推进不代表ArkWeb、物理手机、真实听音或两小时耐久。IIBC材料目前已取得一套完整200题官方模考题本、答案和空白答题纸，私人映射准备为103组/200答案；匹配音频仍缺，完整可听导入包仍为0套。该材料未证实对应某场历年实考，没有用静音代替配套音频或将真实材料生成最终题包。上述兼容修正及保护fixture的合并、CI状态以对应PR为准。
