# Windows Harmony 构建与非破坏性验收准备

2026-10-13，只读现场核查。没有构建 HAP、启动或停止模拟器、安装/卸载应用、发送题包、清理存储、读取签名材料或操作手机。唯一写入为本交付目录。

当前仓库：D:\zzl\托业学习\vocab-work\theme-redesign-20261012\site。真实分支 feat/ui-redesign-v11，HEAD 12317b26b85a71888760b0cc18242d00a843ac74；改版实现尚未提交。后续构建必须包含该工作树已审定修改，不能只导出旧 HEAD 或使用另一份 lantern-site。

## 已核实工具和现场

| 项目 | 现场结果 |
| --- | --- |
| DevEco Studio | 26.0.0.821；buildNumber 261.23567.138.36.2600821 |
| CLI | 1.3.0-stable；现有 wrapper 指定 Studio 并关闭遥测 |
| 编译 SDK | default 元数据：26.0.0.105 / API 26 / Release |
| 模拟器镜像 | 实际存在 HarmonyOS-7.0.0/phone_all_x86，7.0.0.106(SP1)，API 26 |
| Studio Node / Java | v24.14.1 / JBR OpenJDK 25.0.2 |
| 默认实例 | LanternOffline7，phone，HarmonyOS 7.0.0(26.0.0)，stopped |
| 另外两个实例 | 官方引擎按各自 instancePath 读取：LanternContent7、LanternBooks7 均 isRunning=false |
| 连接与进程 | CLI device list 无 active devices；Get-Process 无 emulator/DevEco/hvigor，仅已有 hdc 服务 |
| 新版原生验收 | 本次未执行；旧 v0.3.0/v0.3.3 证据不能代替改版验收 |

绝对工具路径：

- CLI wrapper：D:\zzl\harmony-toolchain\deveco.ps1
- Studio：D:\zzl\harmony-toolchain\studio-26.0.0.821
- Hvigor：D:\zzl\harmony-toolchain\studio-26.0.0.821\tools\hvigor\bin\hvigorw.bat
- OHPM：D:\zzl\harmony-toolchain\studio-26.0.0.821\tools\ohpm\bin\ohpm.bat
- Studio Node：D:\zzl\harmony-toolchain\studio-26.0.0.821\tools\node\node.exe
- Java：D:\zzl\harmony-toolchain\studio-26.0.0.821\jbr\bin\java.exe
- HDC：D:\zzl\harmony-toolchain\studio-26.0.0.821\sdk\default\openharmony\toolchains\hdc.exe
- 模拟器引擎：D:\zzl\harmony-toolchain\studio-26.0.0.821\tools\emulator\Emulator.exe
- Web Node：C:\Program Files\nodejs\node.exe
- Python：C:\Program Files\Python311\python.exe

## 必须保持的镜像路径字符串

D:\zzl\harmony-toolchain\user-data\迁移与启动说明.txt 和 vocab-work/disk-migration-20261011 记录过真实故障：文件迁到 D 盘后，改变 backing 路径字符串曾触发 overlay 重建，导致应用和数据不可见；后来恢复完整原件并逐项验证。旧 C alias 通过 junction 指向 D 盘。当前 Offline ini、Content/Books 官方清单仍使用原 C alias，与说明一致。

现有实例继续使用：

~~~text
imageRoot = C:\Users\Administrator\AppData\Local\Huawei\Sdk
Offline instancePath = C:\Users\Administrator\AppData\Local\Huawei\Emulator\deployed
Content instancePath = D:\zzl\harmony-toolchain\content-emulators
Books instancePath = D:\zzl\harmony-toolchain\books-emulators
~~~

不要为路径统一改成 D 盘 imageRoot，不复制/改名旧实例 overlay，不覆盖原 config/ini，不恢复旧快照回滚本轮数据。本次没有逐文件重验 junction 或迁移备份；保留原字符串依据本机故障/恢复记录和当前配置一致性。

CLI emulator image list 显示 “No matching system images found”，但本机镜像文件及 sdk-pkg 已核实存在。这是 Studio 默认 SDK 与镜像根的识别失配，不是缺少 SDK/镜像。不能据此下载、重置或删除。

## 当前 Windows 构建流程

Linux harmony/scripts/build-offline.sh 保留 API 18/CLT 5.1 基线，不应写成本次 Windows SDK 26 实测。最近成功的 Windows 0.3.3 构建在 vocab-work/exam-library-20261011/native-build-final；隔离 staging 仅去掉 product compileSdkVersion，保留 compatible/target 5.0.0(12)，实际 wrapper 选择 Studio SDK 26。

集成负责人执行：

1. 冻结审定工作树并记录源文件哈希。完成共享 mobile 构建和 sync-web.mjs --check；资源 manifest 不是 HAP 编译。
2. 新建允许写入的 ASCII、无空格 staging，例如 C:\Users\ADMINI~1\AppData\Local\Temp\lantern-ui-v11-unsigned-20261013-新随机后缀。先确认不存在，不覆盖旧项目。中文 D 盘工作区不能直接作为 Hvigor 工程目录。
3. 只复制当前工作树 Harmony 源文件和刚验证的 rawfile/web。拒绝 symlink；排除 .hvigor/build/oh_modules/local.properties、所有签名/账号文件和签名材料后缀。不得复制 private-signed 项目。
4. 在 staging 解析 build-profile.json5，要求 signingConfigs=[]，只移除 product compileSdkVersion。保留 bundle com.lantern.toeic、最低/目标 API 12 和当前版本；不在生产源改 API 或生成签名。
5. 在 staging 工作目录执行已核实 wrapper 命令：

~~~powershell
& 'D:\zzl\harmony-toolchain\deveco.ps1' build --product default --modules entry --build-mode debug
~~~

正常产物：entry\build\default\outputs\default\entry-default-unsigned.hap。保留全新 log，确认 CompileArkTS/PackageHap 实际运行。等待有界，只管理该次自有进程；不停止其他任务或 daemon 绕过失败。

6. 对这次 HAP 执行仓库 harmony/scripts/verify-hap.py，输入必须是这次 exact web；再独立解包 module.json 核实 bundle/versionCode/versionName、SDK/native code 类型。保留 HAP 字节数/SHA-256、web manifest SHA 和实际报告；不复用旧 1,059 项、旧 SHA 或旧结论。

核对命令模板（变量来自本次已验证路径）：

~~~powershell
& 'C:\Program Files\Python311\python.exe' -S -B "$repo\harmony\scripts\verify-hap.py" $hap --web "$repo\harmony\entry\src\main\resources\rawfile\web" --report "$newEvidence\hap-integrity.json"
~~~

未签名 HAP 曾能安装专用模拟器，不代表商业手机可安装。模拟器验证不需要读取私人签名、重新创建证书、Huawei 登录或连接手机。

## 隔离和验收边界

优先创建全新官方专用实例，用同一 bundle 检查空库改版。CLI 已核实提供 emulator create 唯一名称 --device-type phone --os-version 已下载镜像标签，不提供 clone 子命令；不可带 --force。实际创建尚未验证，镜像根识别失配须先解决；仅核实 phone 镜像，不声称已有 foldable/宽折叠镜像或 Pura X Max 硬件能力。不要复制 Offline/Content/Books overlay。

若用 LanternOffline7，它已经有 QA 和学习记录，不是空白可丢弃实例。先读取正常 UI、实际正常导出基线、双次接收稳定文件并按当前模型比较，保全旧学习/词库/考试记录。仅负责人在确认 App idle 且独占实例后可同 bundle 覆盖升级；禁止卸载/清数据。只读导航、搜索、资料和返回不新增学习事件；合成作答/导入使用新输出目录及显式 QA manifest，留存新增记录，不回滚删除。

目前三个实例均 stopped，因此本次没有给出 HDC target；禁止复用历史 5555/5557 或选择第一台设备。启动后联合核对 instancePath/name/isRunning、HDC boot completed、API 和正常 UI，再绑定刚核实的 loopback。未知权限、锁屏或覆盖保留失败证据。

历史成功参数见 simulator-acceptance-20261011/08-correct-root-start.json：官方引擎 -start LanternOffline7 -imageRoot 原C alias -instancePath 原Offline alias -bootMode snapshot。这是历史成功，不是本次启动或新实例创建的证明。

## runner 实质阻塞与待验

phone_smoke.py 安全允许列表和导航仍匹配“训练之境”“托业场景词库”，phone_mock.py 也仍点击旧“主导航/训练之境”。改版 WORKSPACE_NAV 是“今日/练习/复习/进度/资料”，桌面/手机导航名称也变化。旧 runner 会在导航前置失败；必须按本次真实可访问性快照更新定位契约，保留未知覆盖、唯一匹配、祖先裁剪、设备锁及失败门禁，不放宽成坐标猜点或只凭 toast。

runner 不安装/卸载/清数据/读取私有 DB。默认 smoke 包含 force-stop/relaunch，不能在未保存录音时运行。mock 需独占设备、保留旧未交卷考试原截止；不能修改系统时间或迁移数据库来加速。

历史 Emulator 输出已有 DirectSoundCapture 初始化失败。模拟器可验权限失败/保存状态、文件选择器、ArkWeb 回退，但不能证明真实麦克风采音、扬声器听感、Pura X Max 内外屏或物理后台行为。新版实际录音、设备回听、内外屏与手机覆盖升级仍需独立真机验收；本次不安装手机。

本次只读没有阻塞 Web 实现。新版 HAP、实际 ArkWeb 和更新 runner 均未验；新实例的镜像根识别失配是准备待解决项，旧实例的数据保护不能省略。
