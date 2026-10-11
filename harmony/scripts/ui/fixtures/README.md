# 匿名化原生布局夹具

`mock-*.json` 来源于2026-10-11的实际 DevEco 简化可访问性布局：API 26 专用模拟器的题包目录、媒体预检、两题选项及即时文件选择器；旧型选择器来自此前受控设备导入捕获。旧型选择器夹具回归不等于该机型的新版模考已通过。

保留定位所需的 `type/text/bounds/enabled/clickable/visible/scrollable/children`，移除私有节点标识和无关属性；文件名、记录标识及个别动态文字已匿名化。原始布局的 `Web.text` 均逐份确认是包内固定来源 `https://lantern.local/`，因此保留此来源门禁。没有从夹具的简化属性推断 `checked` 状态。

内容为原创合成 QA 标记，不含真题、音频或个人作答记录。固定 bounds 仅用于离线裁剪回归；实际设备动作必须从当次布局重新计算，不可硬编码这些坐标。原始截图、原始布局和匿名化映射保存在私人证据目录，不纳入公开仓库。

`mock-deadline-listening.json` 与 `mock-deadline-reading.json` 来自同日实际只读观察保存的听力/阅读布局，按同一属性白名单裁减。测试中的结果、遮挡、错误与时钟变化均为明确的内存扰动；不存在声称来自未来实测的交卷夹具。

`mock-installed-bundle.json` 是实际 `bm dump -n com.lantern.toeic` 的最小安装元数据，不是布局；仅保留包名、App/模块版本和热补丁版本占位层级。删去账号、令牌、签名、设备及安装时间字段。热补丁的0不能与App的20006混为同一版本。

`mock-empty-web.json` / `mock-restored-web.json` 来自首轮新runner实际导入后相邻的两次结构：系统短暂只暴露可信Web空壳，随后恢复并显示文件内容相同。它们验证有时限的只读等待；未知弹窗、异源、结构冲突和预算耗尽仍失败，不将空壳当成导入成功。

`mock-picker-api26-opening.json` / `mock-picker-api26-download-91.json` 来自选择器首次打开的空壳与随后成熟目录，验证有界只读等待。`mock-picker-api26-crowded-92.json` 来自24项目录的首屏：系统只暴露9个备份，目标合成题包在屏外；备份UUID均替换为固定占位值。滚动后的目标帧复用已有脱敏夹具，帧间转换是离线模拟，不能据此声称真实滚动已通过。
