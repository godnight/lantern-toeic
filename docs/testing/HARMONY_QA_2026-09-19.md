# HarmonyOS 7 本机测试闭环（2026-09-19）

范围：共享学习前端、鸿蒙原生壳、本机记录、导出、生命周期。以 API 26 Windows 工具链和 HarmonyOS 7 模拟器执行；不将模拟器通过计作真机签名、安装或麦克风实测通过。

基线：源码 `2dff1c0`（与已合并 PR #25 的源代码树一致）；旧 HAP SHA-256 `e654ae299d0d834be1961ace571f332ccb346efc033231b21284630c9131e837`。日志与原始设备证据保存在本机 `D:\zzl\harmony-toolchain\qa-20260919`，不提交个人记录或签名材料。

## 设计与执行矩阵

| ID | 场景与预期 | 当前结果 |
| --- | --- | --- |
| A01 | 原有逻辑/下载/打包测试通过；类型、内容和素材检查通过 | 基线64条；修复后79条通过：54学习＋14鸿蒙/工具链＋6包体校验器＋5Web产物。静态检查及Web生产构建通过 |
| D01 | 做完今日听力、阅读、口语后，任务标题不变且仅对应项完成；重开仍一致 | QA-001关闭：4条组件测试先失败后通过；设备首页恢复为Part1已练习，覆盖安装/重启后保持 |
| D02 | 使用配置时区的当地午夜更新推荐；错题继续优先 | 新增边界测试通过 |
| N01 | 编译、HAP 字节码/资源核对、覆盖安装保留已有事件 | 通过：SDK26编译，195资源与源码逐字节匹配，修复包覆盖安装保留原首答 |
| L01 | 首答错误→看解析→复习正确；即时再练不覆盖首答、不虚增间隔 | 通过：p1-02首答A错误/复练D正确同时存在；p1-01即时正确复练后firstAttempts/reviewSchedule不变 |
| L02 | 学习打卡与反馈保存；导出包含完全一致的事件 ID、时间、值 | 通过：1分钟、测试反馈、事件ID/时间/值与JSON备份一致 |
| P01 | 模拟器重启、覆盖安装后，记录/设置完整保留 | 通过：重启→正常包覆盖恢复→拒绝麦克风后，全部8个localStorage键值一致，4作答/1签到/silk设置保留，CRC通过 |
| E01 | 周复盘导出文件可读取，数值与本机账本一致 | 通过：修复后328字节，2道首答、1分钟、0录音及测试反馈准确；禁网版同样导出成功 |
| E02 | 原创题包 JSON 与仓库题目/口语逐项一致，无个人记录 | 通过：68题/5口语逐项深比较相同，无个人字段 |
| E03 | 个人记录 JSON schemaVersion=2；事件与本机存储逐项一致 | 通过：真实下载的2份JSON与导出时账本一致，实际parseStudyBackup读取通过 |
| E04 | 两个主题 ZIP 字节与仓库一致；重复导出不覆盖 | 通过：两包SHA/ZIP CRC一致；题包/个人JSON/复盘/silkZIP各导出两次，旧文件不变 |
| B01 | 系统返回按弹窗→练习→子页→首页退出次序处理 | 通过：设置先收键盘再关窗；主题/练习Back关闭；原图→素材→首页；首页首次提示、双Back退出后可重新启动 |
| V01 | 主题切换持久化；原图可打开/关闭；手机显示无内容截断 | 普通手机竖屏截图通过；原图Dialog和两级Back通过；silk切换/重启保持。折叠态/大字体未验 |
| S01 | 音频播放、停止、速度切换、切后台停止，不残留播放态 | 交互通过：正常及禁网包播放态、0.7×选择、点击停止、立即Home/返回后恢复未播放态；未测实际声音品质或精确播放倍率 |
| O01 | 可验证禁网条件下冷启动、练习、保存、导出 | 权限受限QA包通过：同进程请求拒绝201；冷启动、作答保存、音频启动、复盘落盘、重启保留通过；恢复联网权限探针HTTP200。不是正式包整机断网验收 |
| R01 | 麦克风拒绝、录制取消、真实录音保存和回听 | 拒绝分支通过：系统点不允许，提示需设置授权，不进入录音、不生成记录；Back可关闭。实际录制/取消未执行，音质及硬件仍需验 |
| H01 | SDK 异常注入：页面加载同步抛错/异步失败、下载挂接失败可控处理 | 4条新增实际源码测试通过；编译原两条异常警告消除，正常启动和真实导出复验通过 |

## 缺陷闭环

### QA-001 今日推荐与完成状态错配

- 设备复现：仅存在当天 Part 1 正确首答，首页却显示 Part 2「已练习」。证据 `device/before-art.json`。
- 根因：推荐实时使用当天新增记录更新；完成标记只检查任意听力/阅读/录音。
- 修复：用当地当天开始前的记录确定任务，完成状态匹配具体 Part 和口语 promptId；当天重开仍可复算同一任务。
- 验证：`automated/daily-before-fix.log` 的4条失败 → `daily-after-fix.log` 的5条通过（含当地午夜及薄弱项边界）；`device/fixed-upgrade-ready.json`、`no-internet-after-reboot.json` 设备复测通过。

### QA-002 打开原图后系统返回卡住

- 设备复现：素材库“打开原图”替换主文档，只剩图片；返回提示“页面尚未就绪，请稍后再试”，不能回学习页。证据 `art-original-no-response.json`、`art-original-back-failed.json`（前者文件名沿用最初候选猜测，实际是图片已打开）。
- 根因：原生点击外链处理将 `_blank` 改为当前页打开；图片文档没有学习页面的返回桥。
- 修复：共享前端使用图片Dialog，原生返回优先级50先关闭图片，再由父页面处理返回首页。
- 验证：新增组件回归通过；设备真实打开→Back关图→Back回首页通过；截图 `agent-original-dialog.png` 已目视检查。

### QA-003 SDK 异常处理缺口

- 静态审查发现页面加载未处理同步异常/Promise拒绝，下载挂接API未处理同步异常；不声称正常设备运行曾因此崩溃。
- 增加捕获及错误日志；下载挂接失败无保存成功提示，保留重新挂接能力。
- 4条故障注入及原下载回归通过；SDK26编译、正常冷启动和真实文件导出通过。

## 包体与可重复验证

- 交付修复包：14,989,704字节，SHA-256 `7de9b8f477e2353419511ed1303d5500537cd73eaa3e22fe0bd4ac91a30706da`，未签名debug。源码本地提交 `23ad930`，源码树 `24fea99c603f6190d29c928fb1939d6a0420f16d`；GitHub同树提交 `7cf83ef`。
- Web清单SHA-256 `8b154af916265e2b38288245f8937bad3f3862cc4147522f249476abefe831d5`，195资源全部与包内一致。包体校验报告本身不包含设备验收结论，设备结论单独保留。
- Windows构建：先 `npm --prefix harmony run sync:web`；复制鸿蒙工程到不含中文的隔离目录，保留`signingConfigs:[]`，仅在副本移除旧`compileSdkVersion`，保留最低/目标`5.0.0(12)`；用Studio26附带SDK执行 `devecocli build --modules entry --product default --build-mode debug`；用仓库`verify-hap.py --web ... --report ...`核对资源。仓库API18/WSL基线未被改写。
- 安装使用HDC `install -r`，未卸载、未清除数据；重启使用该模拟器的`target boot`。

## 离线验证边界

隔离staging临时在EntryAbility调用官方`http.createHttp().request`，HEAD请求`https://www.huawei.com/`，`usingCache:false`、连接/读取各5000ms超时，仅记录响应码/错误码，并在finally中destroy请求。无INTERNET版仅从manifest删除`ohos.permission.INTERNET`，其余共享前端、题目和音频相同。正常交付包不包含探针。

- 无INTERNET QA包 SHA `43ccf832f625cf0446d495043d99365b648ea000505e2394268717857860058f`：系统权限清单确无INTERNET，应用请求返回BusinessError201。`probe-no-internet-app.txt`记录；加载题目、作答、内置音频播放态、保存、导出及重启均执行。
- 有INTERNET探针对照包 SHA `cba2d96950a1606b61202cc6d93d8366e04fb3ffca054304768c16cb9d8ce764`：恢复后同请求返回HTTP200，见`probe-online-restored.txt`。前一次在线启动日志未保留到有效结果，不计作通过证据。
- 这是“应用无联网权限时不依赖网络”的验证，没有修改主机网络或其他应用联网权限；不能写成正式HAP在真机整机断网下已验收。

## 证据索引与剩余项

自动化日志：`automated/final-summary.json`、`web-production-tests.log`、`windows-build-fixed.log`、`package-fixed.json`。实际导出深比较：`device/post-ui-export-verification.json`。禁网新增事件/间隔：`offline-before-reboot-verification.json`。重启及恢复键值对照：`reboot-persistence-verification.json`、`restore-denial-persistence-verification.json`。播放→主动停止以`agent-stop-confirm-playing.json`→`agent-stop-confirm-stopped.json`为证据；早期`agent-speed07-stopped.png`命名有误，实际仍为播放态，仅用于速度选项验证。原始模拟器数据只包含本轮人工测试记录，不作为用户学习记录或正式成绩。

真机签名与安装、真实麦克风/扬声器质量、折叠态/大字体、长时间后台和硬件断网尚未验收；手机号认证/原生云同步未实现。未发布新Site。

收尾已恢复正常修复包（无网络探针），当前模拟器停在今日页，silk主题、4次作答/1分钟/0录音。麦克风权限保留在本次测试的拒绝状态，后续正向录音测试需在测试设备显式重新授权；此状态不涉及用户真实手机。

PR #26 首轮CI发现上传路径发生中文编码损坏；已从本地Git blob按base64重新上传、逐文件核对Git SHA，远端修复源码树与本地已测源码树完全一致。`7cf83ef` 的 [Core运行35435509008](https://github.com/godnight/lantern-toeic/actions/runs/35435509008) 和 [Harmony运行35435509016](https://github.com/godnight/lantern-toeic/actions/runs/35435509016) 均已成功。后续以最新PR头为准，不能引用首轮失败构建为通过。
