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
