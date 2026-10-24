# LANTERN · 微光托业

Web/PWA 与 HarmonyOS 共用 React 学习界面和学习模型，提供单词、听读、复习、模考与口语录音练习。

当前交付为 **0.4.5 / 20059**：今日安排的两个操作入口已更新，网页版已部署，手机已原位升级。实际验证状态和已知问题见 [当前状态](docs/PROJECT_STATUS.md)；这里不再堆叠各次开发中的历史快照。

- [打开网页版](https://lantern-toeic-godnight.zhuangzeliang.chatgpt.site)
- [分级验证与发布](docs/RELEASE_POLICY.md)：小改定向验证，大版本完整回归
- [接续开发](docs/CODEX_HANDOFF.md)：先选正确基线，再读取相关代码
- [工程架构](docs/ARCHITECTURE.md)与[团队职责](docs/TEAM.md)
- [鸿蒙离线构建](docs/testing/HARMONY_OFFLINE_BUILD.md)

先按改动范围选检查；依赖未变时复用现有环境。完整初始化脚本 scripts/codex-setup.sh 仍保留用于新环境或全量验证，不作为每次小修改的默认入口。账号密钥、签名材料和真实用户数据不进入仓库。

记录正确的完成状态：源码提交、构建、网页部署、App 安装与实际功能验证分别说明。录音杂音仍是已知问题，按用户要求暂缓；真实短信服务未启用。

[此前 README 与发布历史](https://github.com/godnight/lantern-toeic/blob/a4b78796456094ae840770b48c5a9bd5554d7306/README.md)保存在 Git 中；历史“本轮未发布/未授权/待检查”只代表当时状态。
