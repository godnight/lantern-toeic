# 最终冻结包：构建与独立 QA 原生启动证据

2026-10-13，收到 Root 最后 I04/I08 修复后的明确源码冻结通知。本次使用新的 ASCII 隔离快照构建未签名 HAP，并仅在本工作线新建的 LanternUIQA4d5098e7 实例执行官方保留数据升级、启动及应用冷启。旧 Offline7/Content7/Books7 实例、overlay、原 C imageRoot、生产 rawfile、签名与系统隐私/安全/调试设置均未改变。本链路没有审批请求或待审批项。

## 精确交付物

| 项目 | 结果 |
| --- | --- |
| 构建证据目录 | build-lantern-ui-v11-knsxbchb |
| ASCII staging | C:\Users\ADMINI~1\AppData\Local\Temp\lantern-ui-v11-knsxbchb |
| HAP | build-lantern-ui-v11-knsxbchb/lantern-ui-v11-unsigned-local-only.hap |
| 字节 | 44,292,998 |
| SHA-256 | d10202ec9ffc908e15199d8917cc270214d36b351161d90403a786faa604f573 |
| SDK / 编译系统 | HarmonyOS 26.0.0.105 / API 26 |
| 包身份 | com.lantern.toeic，0.3.3 / 20009，debug，未签名 |
| min / target | API 12，50000012；没有为了本次验收修改应用 API 声明 |
| 完整构建输入 | 1,229 项，当前路径集合与 SHA 全部匹配；新增/缺失/修改均为零 |
| 打包 web 资源 | 1,071 项逐字节、长度和 SHA 与 staging manifest 全部一致 |
| 最后静态复核 | 2026-10-13 10:10:47 UTC，安装冷启后当前源仍匹配 |
| source manifest SHA-256 | 5d0527bcf3a110e7d4791b8205f632c842460c0ce2c105d1487416c1a6e2e3d6 |
| web manifest SHA-256 | 1f98b5d366ffddecbd78fe7c0a0cdfd0cb187bb1b149d1f35cac8588ae7d1d3c |

sdk-build.stdout.log 记录真实 CompileArkTS、PackageHap 和 BUILD SUCCESSFUL；sdk-build.stderr.log 明确 No signingConfig。SDK 中 SignHap 任务名不代表进行了签名。未读取证书或生成签名。

final-freeze-proof.json 是静态验证器结果，其中 installed/arkWebOrDeviceTested=false 表示该静态验证步骤本身没有操作设备；实际后续安装与 ArkWeb 启动记录在下述 native-smoke-proof.json。不能把静态步骤的字段误读成最终包未安装。

## 源码范围与复现

source-manifest.json 的 scope 是精确定义：app/lib/components/content/public/mobile/harmony/hooks/types/vendor，加根 package.json、lock、tsconfig、postcss、.gitignore、release-manifest；排除生成物、Harmony tests/scripts/ui 和非 public 的说明文档。public 中真正随包发行的许可/说明资产仍全部保留。根 README、docs、tests、reports 后续归档不在此证明范围；package/lock 的修改仍属于构建输入变化。完整路径重新枚举能发现新文件、删文件及改文件，详情见 SOURCE_SCOPE.md。

源工作树：feat/ui-redesign-v11，基准 HEAD 12317b26b85a71888760b0cc18242d00a843ac74。本次绑定未提交的实际冻结源码，不假定该 HEAD 或 main 含全部实现。

运行 build-isolated.py 可创建新 staging，执行 mobile build、1015 音频 sync/check、Harmony web sync/check、隔离 SDK 构建。SDK 真实命令为：

~~~powershell
& 'C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\native\powershell\pwsh.exe' -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File 'D:\zzl\harmony-toolchain\deveco.ps1' build --product default --modules entry --build-mode debug
~~~

该命令仅以新 staging/harmony 为工作目录，使用进程级 HVIGOR_USER_HOME 指向 staging 隔离缓存；现成纯 pnpm 包被复制作为缓存种子。源码快照里的旧 compileSdkVersion 字段仅在 staging 移除，target/min 保留，mobile 缓存也仅重定向 staging。-ExecutionPolicy Bypass 是该 PowerShell 进程参数，不写系统安全策略。全部 argv、cwd、退出码和这两处 staging-only 差异见 result.json。

## 唯一自有实例升级及冷启

证据目录：native-qa-LanternUIQA4d5098e7/final-smoke-build-lantern-ui-v11-knsxbchb-100923。

升级前官方实例 inventory 核实唯一自有路径及运行状态，HDC 明确使用 127.0.0.1:15551，boot.completed=true、系统 API=26、系统 emulator 7.0.0.106(SP1DEVC00E999R4P11)。HAP 安装前再次校验精确哈希。

~~~powershell
$hdc = 'D:\zzl\harmony-toolchain\studio-26.0.0.821\sdk\default\openharmony\toolchains\hdc.exe'
& $hdc -t '127.0.0.1:15551' install -r '<本报告精确 HAP 的绝对路径>'
& $hdc -t '127.0.0.1:15551' shell aa start -a EntryAbility -b com.lantern.toeic -m entry
# 下述只停止该自有 QA 实例中的本应用，再进行应用冷启，不停止模拟器。
& $hdc -t '127.0.0.1:15551' shell aa force-stop com.lantern.toeic
& $hdc -t '127.0.0.1:15551' shell aa start -a EntryAbility -b com.lantern.toeic -m entry
~~~

官方 hdc help 定义 -r 为 replace existing application。实际 install 收据为 install bundle successfully，没有 uninstall/clear/reset/-g；没有真实数据比较，因此只能确认采用了保留数据升级命令，不能据此声称验证了用户旧学习数据完整性。实例自建且没有导入真实数据。升级后 bm 身份仍为同 bundle/v0.3.3/20009/debug/API12。未签名开发包在此独立模拟器被正常接受，不能据此推断商用真机的签名规则。

初始 PID 7949，应用 force-stop 后 pidof 为空，冷启 PID 8038 且后续仍存在；AA 状态显示前台。未使用 HDC input/UI bridge、debug attach、fport 或系统 privacy 改动。当前 QA 模拟器仍运行；没有自动切换可见窗口或停止任一模拟器。

## 已观察到的 ArkWeb 状态及限制

两个约 3 秒日志窗口均记录主 HTML 424B、JS 1,332,784B、CSS 371,845B 返回 200，DOMContentLoaded、PageEnd HTTP200，首次绘制为初启 564ms、冷启 437ms。有限日志中没有明确 JS 异常或 renderer crash 标记；不能写成系统零错误或业务界面完全初始化。

两次均存在 2 个 26B、text/plain 的子资源 404，URL 被系统掩码，当前无法归因；没有猜测 favicon，也没有重打诊断包。静态定位及最小安全诊断方案见 404_DIAGNOSTIC_PLAN.md；本轮按协调保留该限制。native-smoke-proof.json 的 paintMarkers 聚合正则遗漏了实际 FCP/FMP 行，独立 native-log-review.md 列出原始行号；没有因此重复设备操作。

独立复核已完成：同一最终 smoke 目录下 native-log-review.md 核对 HAP/两份原始日志哈希和 12 条聚合加载记录，未发现新增实质阻塞。原始窗口中 E 级分别 100/106 条、F 级均零；平台错误仍存在，不能改写为零错误或全部无害。报告明确原生日志 ready/前台状态、引擎像素尺寸和单次 FCP/FMP 不等价 UI、数据或性能验收。

本报告覆盖 SDK 编译、完整资源/源码一致性、独立 QA 安装、AA 生命周期及 ArkWeb 加载日志。原生点击/返回、四主题视觉、录音与播放、文件选择器、持久化数据、云同步等交互没有通过此链路验证。初始模拟器日志也有 DirectSoundCapture 不可用提示，不可声称麦克风已通过。

供用户打开 QA 可见窗口的官方手工步骤见 native-qa-LanternUIQA4d5098e7/manual-visible-window.md。官方帮助没有动态显示既有 headless 实例的命令；须协调保存和 smoke 结束后，仅停止本自有 QA，再沿用原 instancePath/C imageRoot/端口，以 coldboot（保留数据）且省略 -noWindow 启动。这里仅提供步骤，没有执行切窗或停止。

## 阶段与失败记录

07:40、07:50、08:19、09:03 均保留为历史候选，不能代表最后生产源。第一次本轮 smoke 在 install 之前因证据脚本误用 bm 字段 distributionType 而失败；实际字段是 appDistributionType，修正后在新的证据目录重试同一 HAP，未重新打包或读取数据。失败日志保留于 native-qa-LanternUIQA4d5098e7/final-smoke-build-lantern-ui-v11-knsxbchb。旧构建与工具失败也全部保留，不覆盖历史 proof。
