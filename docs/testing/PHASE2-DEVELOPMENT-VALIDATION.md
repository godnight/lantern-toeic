# P2-r3 当前开发验证

冻结 `P2-20261014-r3-f5ab766451ef` / `0.3.4/20012`。相关返回／旧搜索／词典／例句／词卡UI共85项开发检查通过，其中新增真实TSX与NativeBack注册器契约16项；同一新增测试对r2旧源码8PASS/8FAIL，当前16/16。受控事件／history/DOM不代替实际浏览器或ArkWeb。当前冻结命令和结果以 `../dev-validation/*frozen-r3.log`、最终浏览器／SDK证据与外层 `DELIVERY-P2-r3.json` 为准。

r2源／资源／HAP全保留。r2独立已验证的进度、升级／恢复及IME均保留其输入与范围，本版只改统一Lookup返回／关闭后焦点和版本码，不能自动继承整版通过。业务store、IME／Native桥、模考／媒体未改，不重复未受影响的151／643整套检查。新候选仍须真实系统Back（含先收IME）、两状态返回、焦点／滚动／候选／旧事实保持的独立复测，未push。

r3实际冻结验证：85/85相关组件检查、tsc、根Web构建、构建后MJS34/34及单次SDK HAP均通过；1,091资源、identity、图标与冻结源一致。开发浏览器21/21、25张实际DPR图，覆盖两主题320/DPR2和430/DPR3的详情候选后Escape／列表Escape／详情BrowserBack／NativeBack注册器映射／显式返回结果，以及p5-01已提交解析点词返回。原DOM触发词焦点、scrollDelta=0、history.state及旧事实逐条保持，候选一次；Practice选项／原Attempt／解析tab不变，未添Checkin／review。页／控制台／HTTP／外部错误0，自有服务停止。报告 `../dev-lookup-return/2026-10-14T19-19-23.358Z-d5591dae/report.json`（相对site外层），SHA `723987bd6dc0010b3af1ff14840381b052a4dd396d7b64cea30a6692579df339`。根开发亲看430返回词卡和Practice图，焦点可见；仍不是独立QA或ArkWeb系统返回／IME证据。

以下保留r2及更早开发记录：

---

# P2-r2 当前开发验证

冻结 `P2-20261014-r2-e208cb589d98` / `0.3.4/20011`。根Web构建、tsc通过；第二阶段CJS151/151（新增2个日历日期边界检查）、相邻主题／owner/UI检查39/39、构建后MJS34/34通过。151与39有重叠，不相加称190用例。最终响应式报告、HAP完整性及SHA见外层 `DELIVERY-P2-r2.json`。本轮按窄屏和展示改动复测相关范围，没有重复整套643业务检查；r1原生helper16/16保留为未改模块的历史证据。

`dev-validation/*frozen-r2.log` 是本次日志；`ui-theme-r2.log`为相邻主题检查。r1独立QA37/41含4项进度失败，不能写整版通过。r2模拟器、非空数据升级、IME、实际音频和其他未验项由独立小测逐项报告；导航整合设计差异仍待dot／设计确认。

最终冻结开发响应式回归40/40通过，40张实际DPR截图；两主题320/359/430/1280及359触摸浏览器分别验证进度七列、六导航、CTA、首页单词首卡／品牌与保存后的日历交互。源前后一致，页面／控制台／HTTP／外部请求错误0，自有服务已停。报告 `../dev-responsive/2026-10-14T17-53-49.288Z-eaed023d/report.json`（相对site外层），SHA `da957aef661a0b6773384e4d524b445362d2561e878f59c9a1e72f1096cb5c9e`；这是Chrome共享React夹具，不是生产Web Worker、ArkWeb或独立QA。根开发亲看奶油320首页和空洞359触摸日历原图，有限范围未见截断，不称精确还原或全状态视觉通过。

以下保留r1交付时的开发检查，不覆盖后续独立QA：

---

# 第二阶段开发检查

本文件记录开发自测，独立 QA 由微光-小测维护。当前已冻结 `P2-20261014-r1-2c3061fdf74b`，Web 与 unsigned HAP 构建完成，等待独立 QA；不能引用旧 V1 或 Demo 结果作为本版通过。

新增行为检查分文件覆盖原子仓储、词汇计划／反馈／候选、完整题组选取、持久练习／结算、旧 Study 同内容幂等、例句 token 与 UI 保存边界。最终命令、日志、源输入及产物身份将在冻结交接中登记；未验项按实际保留。

测试采用合成记录和隔离存储，不读取用户实际学习数据。Web 浏览器的 nativeMode 夹具只验证共享 React 与浏览器存储，不能代替 ArkWeb、系统 Back、系统文件选择器或真机音频。音频小样自然度尚未试听。

## 冻结候选实际结果

- CJS：643/643，日志 `../dev-validation/cjs-tests-frozen-r1.log`（相对工作区 site 外层）。
- 类型：`tsc --noEmit --incremental false` exit0；内容结构68题、5类口语、22资料记录通过。
- Web：`scripts/build-verified.mjs` exit0；构建后MJS 34/34。
- 原生helper：toolchain／下载／entry受控契约16/16；SDK实际HAP构建及1,091资源核对通过，未安装设备。
- 开发浏览器：最终11流程+零错误gate 12/12，22截图实际320/DPR2与430/DPR3；无横溢出，页面／控制台／HTTP错误0。仅共享React nativeMode夹具。

源输入和包身份、日志与未验项统一见 [交接](../phase2/IMPLEMENTATION-HANDOFF.md)。主chunk>500kB和punycode警告保留。以上分项不能相加称全产品验收；独立QA和鸿蒙系统交互仍未执行。
