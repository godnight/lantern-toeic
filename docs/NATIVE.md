# 微光托业：鸿蒙原生工程

唯一维护的原生目标是HarmonyOS。Android/iOS工程、专用工作流、Capacitor配置和依赖已按用户要求删除；旧实现可从Git历史查看。

`mobile/`保留鸿蒙内置网页的Vite入口，复用根目录React界面、题库、素材和依赖；它不再代表Android/iOS工程。`harmony/`包含ArkTS/ArkUI/ArkWeb容器和资源同步脚本。

```sh
bash scripts/codex-setup.sh
npm --prefix harmony run sync:web
npm --prefix harmony run check:web
```

这只构建并核对鸿蒙网页资源。HAP编译、签名、安装和真机验收需要DevEco Studio、HarmonyOS SDK及授权设备。工程声明联网权限，但原生学习数据仍保存在本机，手机号认证和跨设备同步尚待实现。

- [鸿蒙构建、权限与设备验收](../harmony/README.md)
- [平台范围RFC](rfcs/0001-harmony-only-platform.md)
- [手机号认证与联网数据RFC](rfcs/0002-phone-auth-and-online-data.md)
- [Codex接续入口与迁移边界](CODEX_HANDOFF.md)
