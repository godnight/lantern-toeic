鸿蒙设备 UI 自动化（2026-10-11）

交付状态
Python 3.11+ 标准库 runner，35 项离线检查通过；已在 HarmonyOS 7 / API 26
专用模拟器、v0.3.0 实际完成默认非写入词库 smoke。物理手机上的本 runner 尚未执行。
首次 live 暴露固定导航遮挡及布局快照混用，两项均先复现、修复、回归后重新 live 通过。
报告：[模拟器验收与缺陷闭环](../../../docs/testing/HARMONY_MOCK_QA_2026-10-11.md)。
模考导入/备份已另行受控操作验证，尚未成为本 runner 的无人值守模考套件。

文件
  phone_smoke.py                  真实 CLI/HDC runner 与备份比较器
  invoke-cli.ps1                  保留参数边界、UTF-8 输出的 PowerShell 适配
  test_phone_smoke.py             无设备离线测试
  fixtures/                      从既有真机布局提取的测试数据
  picker-folders.example.json     此系统文件选择器的目录文字示例

安全与默认行为
必须显式提供 --device（HDC target，不接受模糊友好名称）、--cli、--hdc、--out。
默认只接受 127.0.0.1:<port>，且必须在官方 emulator list 中被识别为 running。
物理机另需 --allow-physical-device；自动化配置不得默认打开此选项。
--out 必须是新目录，避免覆盖证据。不卸载、不清数据、不删除手机文件、
不安装包、不改网络、不改系统权限、不读取签名材料或应用私有数据库。
--idle-app-confirmed 表示测试前应用没有未保存录音/操作；冷启动会 force-stop。
这应在专用测试设备一次准备后由调度脚本固定传递，而非每次请用户看手机。
正式自动化建议使用专用已解锁测试机，由自托管 Windows runner 独占 USB。
解锁、开发者模式/HDC授权、应用预装及权限预置是实验室准备，不由本脚本绕过。
脚本无自动解锁、无 PIN 输入，不恢复到用户未授权的网络/权限状态。
并发执行、用户同时触屏、通话或通知遮挡会影响结果，应独占设备并保存失败证据。

运行（将 TARGET 替换成运行中模拟器的 127.0.0.1:<port>；未写死真实设备标识）
  python phone_smoke.py run --device TARGET --cli D:\zzl\harmony-toolchain\deveco.ps1 --hdc D:\zzl\harmony-toolchain\studio-26.0.0.821\sdk\default\openharmony\toolchains\hdc.exe --out .\runs\smoke-001 --idle-app-confirmed

默认 smoke 路径
  force-stop/start -> 训练之境 -> 托业场景词库 -> 搜索 reservation ->
  读取已有收藏状态 -> 词卡自测 -> 查看释义（不评分）-> 返回词库 ->
  冷启动 -> 再查询 -> 已有收藏状态应相同。
不改变收藏、不产生自测评分事件，不触发导出/导入或麦克风。
搜索词可用 --word；默认词与现有词库一致，严格区分 reservation / advance reservation。
首次运行若尚在引导页、锁屏、搜索框已有内容、CLI输出异常，立即失败取证，不猜测操作。

专用测试机写入路径（明确留下测试记录，不自动回滚/清理）
在上面命令追加 --dedicated-test-device。
若测试词尚未收藏，新增收藏；评分第一张词卡一次；冷启动后检查收藏和复习标志。
这验证 UI 与持久化链路，但“状态存在”不等于验证精确的事件增量。
若需精确验证事件增量，可对导出的备份做事件 ID/内容比较，不用生词数冒充事件数。
严禁将此模式自动用于个人日常机。即使专用模式也没有清数据选项。

重复导入（专用模式的可选扩展）
追加 --duplicate-import --export-dir /实际/Download/应用子目录 --picker-recipe picker-folders.example.json。
--export-dir 必须由集成者先核实为 HDC 可读的该应用公共下载目录；不同系统位置可能不同。
脚本先从 UI 导出基线，然后选中该次导出的准确文件名导入两遍，每次重新导出；
从公共目录只读 file recv 三份 JSON，并比较事件 ID 集合和完整内容，而非只看成功 toast。
不能读取公共导出目录时应跳过该扩展，报告未测；不得改为提权或清应用数据。
目录 recipe 只允许一组准确可见文字；不允许任意 shell 命令。
已保存证据中的路径文字为 Download / LANTERN TOEIC，但可能随系统语言/版本改变。
选择器如果已停留在目标目录，会直接按本次生成的准确文件名选择；重复文字或不认识的
系统窗口会失败，不使用固定坐标兜底。不会自动允许权限弹窗。

离线比较已取回的三份备份：
  python phone_smoke.py compare-backups before.json after-first.json after-second.json
输出完整内容是否相同、事件数量、文件哈希；不会输出词库事件内容或设备标识。

定位与限界
每次操作刷新 ui layout --format json，以可见 text/type 唯一匹配，再计算当前 bounds。
剪裁 scrollable / Web / dialog 祖先，避免旧布局里 LIBRARY 节点被侧栏 footer 遮挡。
对同一 Web 内已知“主导航”和“学习状态”扣除遮挡，保留其自身按钮；完全遮挡时
先滚动再定位。点击、搜索输入和滑动采用剩余可操作区域。滚动节点与遮挡树必须来自
同一布局快照；旧快照节点直接拒绝，未知弹窗仍不自动操作。
缺失节点最多六次滚动；重复候选直接失败。滑动坐标是当前滚动区的比例，不是屏幕常量。
仅在新挂载词库中识别唯一 textField；输入后检查文字确实更新。
键盘用 HDC uitest Back 收起，随后必须重新找到词条；不能收起时按失败取证，不盲点。
UI树无法证明所有覆盖/层叠关系；因此每一段保留截图，并在首轮验证新系统/折叠形态。
需要维护的稳定接口：页面中文标签、节点角色、NativeDownloads下载文件前缀。

证据与退出码
每条命令有 argv（device已脱敏）、时间、退出码、stdout/stderr。
阶段截图、原始布局、失败截图、应用错误/崩溃日志、result.json 均在 --out。
证据可能包含用户页面文字/文件名，只保存在本机；不自动上传 GitHub 或云端。
退出 0 表示该次 UI 断言通过；1 为运行失败；2 为参数/启动前条件错误。
错误日志中的 ArkWeb/Ace/图形框架 E 级消息不自动算应用崩溃；需关联时间/堆栈。
当前日志收集是辅助证据，未实现自动将所有平台崩溃格式解析为测试失败。
锁屏、断连、权限弹窗应作为环境阻塞输出；不能记作功能通过。

录音/声音自动化边界
当前 runner 不自动录音、不弹权限申请，也不改设备网络。
后续专用测试机可预先授权麦克风，通过 UI 录音 -> Home/后台 -> 返回 -> 保存 -> 冷启回听。
音频文件解码后的时长、RMS、峰值、非静音比例及测试音相关性可自动判断“有信号、
是否截断/静音、是否保存”；需要固定外部声源/声学夹具才能稳定测麦克风链路。
播放器状态变成 playing、音频有波形，都不能证明扬声器在真实空间发声。
扬声器可用外部测量麦克风或回采设备检测；主观清晰度/失真需要抽样听音确认。
自动 signal pass 和 human listening pass 必须分别记录，不能伪造用户已听到。
离线测试应由实验室预置网络状态；仅关闭开关的截图不等于抓包证明完全无网络。

原生模考回归
专用模拟器的两题包导入、两答案冷启及四份真实备份核验见 MOCK.md。
该套件独立于词库 smoke；不得与真实时间观察器同时操作同一模拟器。

验证与集成
  python -m unittest -v test_phone_smoke.py
所有测试只读 fixtures 或临时目录，不运行 HDC、不运行手机 UI。
离线测试已纳入 CI；有设备的实际 run 需单独在受控 Windows 自托管执行器调度。
专用模拟器默认 smoke 已 live 通过；写入/重复导入扩展及物理机仍需各自验收。
通过 task scheduler/CI 定期调用只需设备保持可用；不依赖聊天代理一直运行。
应使用设备锁（CI concurrency 或文件锁）、独立证据目录和失败通知，避免多轮争抢设备。
沿用现有 tests/native-lifecycle.test.cjs、tests/vocabulary.test.cjs、
tests/repo-review-regressions.test.cjs 验证状态机/幂等；本 runner 验证实际 ArkWeb/文件选择器链路。

依据
本机 @deveco/deveco-cli README 的 ui layout/click/text/swipe/screenshot/log 帮助；
vocab-work/phone-registration 中 2026-10-11 折叠/展开布局、词库实测与导入证据；
components/ui/sidebar.tsx 的独立 overflow-auto，vocabulary-library.tsx 的可见标签及备份按钮。
模拟器启动排查
首次协议须由本人确认；本机此次已明确同意并完成官方接受流程。
若 CLI 报没有镜像，先核查已安装镜像与启动参数；不要据此重复下载或重置实例。
本次 CLI 指向 Studio SDK，镜像却在用户 Huawei SDK 下，改用官方 Emulator.exe
的 -imageRoot 指向包含 system-image 的 SDK 根目录后正常启动。不是直接指向
system-image 子目录。以 emulator list、HDC boot.completed 和实际 UI 联合确认就绪。
