# 两次子资源 404：只读定位与最小 QA 诊断方案

本次未修改生产源码、重新打包或安装。对象是已安装的 09:03 历史候选 SHA-256 1fa43622e1c740d76a943889de69b9778d5466dc0892f0be3be7765655cccb8a，及其归档源快照；当前工作树继续变化，不拿它替代候选源。

## 已完成的静态核对

对 HAP 内全部 1,071 项资源枚举，并扫描 7 项 HTML/CSS/JS/SVG 文本资产中的 markup href/src/poster、CSS url 和候选静态 JavaScript 路径字面量。结果保存在 native-qa-LanternUIQA4d5098e7/static-404-audit.json。

- 主 index.html 的两项 JS/CSS 引用都存在，实际日志也均为 200。
- CSS 中四项旧主题图路径全部存在。是否实际请求取决于匹配的元素和计算样式，不能仅凭字面量当成启动请求。
- 扫描到 /sw.js 字面量而 HAP 中不存在它，这是 native sync 明确排除的 PWA 文件。归档 StudyApp 只有 !nativeMode 时注册 serviceWorker，归档 mobile/main 提供 nativeMode=true。因此此字面量不能归因给启动时两个 404。
- 原生 HTML 没有 manifest link 或 favicon link；不能据此猜测实际 404 是 favicon、manifest 或无害路径。
- 归档原生音频模板 /audio/offline/ + clip.file 的 1,015 个文件全部存在；通用词典 /dictionaries/ + metadata.file 对应 zh-en-63cf606ec4d0.json 存在；Practice/Speaking 的直接 image src 对应 /images/office-practice.webp 也存在。记录为 static-template-audit.json。
- 编译 JS 中含 /api/study、vocabulary、recordings、exam-library 等字面量，它们不是 rawfile 资产。原生 owner=null 的学习/词库同步门禁存在；这里只确认代码条件，不将字面量或条件分析当作实际请求轨迹。

扫描不是 JavaScript 完整执行分析；动态拼接、浏览器隐式请求、用户以后导入的 Blob 和当前 masked request ID 关联仍不在证据范围。原始与冷启两次都有两个 26B、text/plain、404，但 URL 未知。仅靠现有日志无法定位具体路径。

早期模板核对曾误把 question.image 当成 basename 拼接，归档 Practice 实际直接 src={q.image}，数据已含完整路径；已按真实 JSX/JSON 更正，初始错误分析另存，不能引用为缺失资源。

## 官方支持的诊断接口

本机 SDK 26.0.0.105 的官方声明：

- ets/component/web.d.ts:6423：onHttpErrorReceive(Callback<OnHttpErrorReceiveEvent>)；请求/响应对象可用。
- 同文件:2777：getRequestUrl()；:2798：isMainFrame()；:2910：getResponseCode()。
- @ohos.hilog.d.ts 定义 warn(domain,tag,format,args)，domain 范围 0x0–0xFFFF；参数默认 private，可对确定非敏感的公共参数使用格式中的 public 标记。

不用启用 WebDebuggingAccess、DevTools、HDC fport/attach、系统 hilog privacy 开关或 UI bridge。

## 最小方案（待 root 冻结后，只在隔离 QA native staging）

首选只在 staging 的 Index.ets readAsset catch 中记录缺失公共资产路径，因为该位置已经拿到 localPath 处理后的 rawfile path，并明确返回 404。不需要新增请求拦截、改响应行为或开放 JS bridge。若需区分 HTTP 主/子资源，再增加官方 onHttpErrorReceive，仅处理 status >= 400 的可信本地 origin。

诊断安全边界：

1. 独立临时 QA native 构建才开启常量，生产源/正式包默认没有此日志；记录 staging-only delta 与新 HAP 哈希，不能冒充未改原生字节的生产验收包。
2. 使用现有 localPath 先校验 origin、剥离 URL query/fragment、解码并拒绝 traversal/NUL/backslash。日志前再拒绝解码后残留问号、井号、控制字符，长度最多160。
3. 仅输出公开静态资产目录 assets/images/icons/dictionaries/audio/offline 的安全 ASCII path，及审核过的根静态文件名。API、学习、录音、备份、未知用户路径只输出固定类别占位符，不输出实际路径。
4. 不记录完整 URL、query、fragment、origin、headers、cookies、body、错误对象、词条查询、账号、题包或学习记录。不要为识别 URL 而关闭系统隐私过滤。
5. 仅在当前自有空白 QA 实例运行初始启动和冷启，不输入或导入真实数据，不向旧实例或手机安装诊断包。
6. 使用一个独立 HiLog tag，只将审核后的静态路径作为 public 参数。public 指定属于该条应用诊断参数，不改变系统 privacy/debug/security 设置。其他系统日志保持默认掩码。

建议事件形状为：固定 tag、code=404、safe-static-path 或固定类别、mainFrame 布尔值（只有 HTTP callback 时）。readAsset catch 日志已经能证明真正缺失的 rawfile；不要打印整个 event/request/response。

执行后由官方 hilog -x -P 已核实appPID -T 独立tag 非阻塞读取，保留初次和冷启日志，并对实际安全路径核对冻结 HAP 中文件/引用。若类别仍为 unknown，不扩展成任意完整 URL 输出；先审查该类别再缩小诊断。定位后诊断构建保留私有证据，最终正常包保持原有隐私/资源响应行为。

当前仅交付方案，未实现、重建、安装或切换任何诊断/系统开关。等待 root 最终全量与新的明确冻结后，再进行正常候选升级/冷启及必要的独立 QA 诊断。
