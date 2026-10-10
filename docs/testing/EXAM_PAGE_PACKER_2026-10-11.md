# 本机 PDF 原页题包工具测试

执行日期：2026-10-11（Asia/Shanghai）。本轮新增开发工具、测试及文档，不改变 v0.3.0 App 运行代码、题包格式、版本号、已发布附件或 Site 部署。没有将真实官方试卷转换、上传或内置产品。

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
