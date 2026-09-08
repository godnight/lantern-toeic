# 微光托业 · HarmonyOS 原生工程

本目录是 Stage 模型的 ArkTS / ArkUI / ArkWeb 工程基础，目标兼容 HarmonyOS 5.0 / API 12 及以上。学习界面、题库和主题复用已有 React 前端；原生容器处理本地资源、麦克风授权、外部链接和返回键。

**当前没有可安装的 HAP。** 已验证共享前端构建和资源复制，尚未运行 HarmonyOS SDK 的 ArkTS 编译、资源编译、签名或真机验收。`HarmonyOS shared asset check` 工作流生成的文件只是网页资源，不能安装到手机。

## 准备共享资源

在仓库根目录安装依赖，再运行：

```sh
npm ci
npm --prefix harmony run sync:web
npm --prefix harmony run check:web
```

脚本构建 `mobile/dist` 并同步至 `entry/src/main/resources/rawfile/web/`，按字节核对每个文件及其 SHA-256 清单。生成目录不进入 Git。原生模式不注册网页 Service Worker；网页安装清单、离线兜底页和 Service Worker 文件不打入原生容器。

## 在 DevEco Studio 编译

先运行 `node harmony/scripts/check-toolchain.mjs --sdk=/你的SDK目录`（在仓库根目录）。命令只检查工具及目录是否存在，缺项时退出码为2；它不认证SDK版本、不安装工具、不生成HAP。`--report-only` 可用于收集缺项报告。SDK目录也可通过本机 `LANTERN_HARMONY_SDK` 设置，不提交本机路径或签名材料。

1. 使用 [DevEco Studio](https://developer.huawei.com/consumer/en/deveco-studio/) 打开本目录，安装匹配的 HarmonyOS SDK，完成工程依赖同步。
2. 当前工程模型和编译/目标/兼容 SDK 基线为 `5.0.0(12)`，这不是最新 SDK 的声明。如果当前 IDE 要求升级工程模型或编译 SDK，通过其正常升级流程处理；提高最低兼容版本前先核对目标手机。
3. 在工程签名设置中配置开发签名，选择已连接的鸿蒙手机或模拟器，构建并运行 `entry` 模块。
4. 编译成功后再做下列设备验收；完成前不把工程标记为已交付的鸿蒙安装包。

当前工作环境没有 DevEco Studio、HarmonyOS SDK、Hvigor、OHPM 和 HDC。仓库不包含 SDK、签名私钥、证书、设备授权文件或本机路径。实际签名配置应保留在开发者本地，不提交凭据。

## 容器边界

- `https://lantern.local/` 是容器内部固定来源，不是在线服务器。该来源的 GET 请求从打包的 rawfile 读取；缺失资源返回本地 404，不转向网络。稳定来源用于根路径图片、localStorage 和 IndexedDB；有用户数据后修改来源须先做迁移。
- 麦克风权限仅在页面申请录音时请求，系统允许后只向该本地来源授予音频采集。摄像头等其他资源请求被拒绝。音频编码、录制和播放能否工作仍需设备验证。
- 允许 DOM 存储，禁用文件访问、混合内容与位置访问。外部 HTTPS 链接交给系统处理，系统可能打开浏览器或匹配的应用。
- 原生返回键先询问 React：处理录音、关闭弹窗、退出练习或回到首页；页面明确表示没有待处理内容后，才查询 Web 历史或双击返回退出。桥接未就绪、异常或超时都阻止直接退出。
- 本机学习记录与网页账号尚不互通；删除应用可能丢失本机进度与录音。没有把网页身份或令牌注入原生容器。

## 真机验收待办

- 手机型号、HarmonyOS 版本和 API 兼容性；冷启动、断网启动、全部高清图片加载。
- 重启后进度与录音保留；原生安全区、系统字体、键盘和返回手势。
- `isSecureContext`、`mediaDevices`、MediaRecorder 支持；麦克风拒绝、允许、撤销、录音回放。
- 进入后台、锁屏和来电对录音的影响。UIAbility 前后台事件已接入固定页面协议，后台结束录音、释放麦克风并保存；进程被系统强杀时无法保证末尾音频回调执行。
- 已补齐并用实际共享源码回归：原生后台而 `document.hidden=false` 时停止录音、迟到权限结果废弃、返回等待录音保存、保存失败时保留/重试、返回取消准备。原生 SDK 与真机仍须验证权限回调和前后台事件的实际时序。
- 外部资料链接、系统语音朗读、导出和下载。不同 ArkWeb 版本的浏览器能力需要逐项核验。

## API 依据

实现独立编写，参考以下官方 API：

- [OpenHarmony API 12 Web 类型](https://github.com/openharmony/interface_sdk-js/blob/OpenHarmony-5.0-Release/api/@internal/component/ets/web.d.ts)：请求拦截、权限事件和音频资源类型。
- [WebResourceResponse](https://github.com/openharmony/docs/blob/master/en/application-dev/reference/apis-arkweb/arkts-basic-components-web-WebResourceResponse.md)：异步响应与 ArrayBuffer 资源。
- [华为 Web 音视频指南](https://developer.huawei.com/consumer/en/doc/harmonyos-guides/web-rtc-V13)：系统权限和 Web 权限衔接。
- [UIAbilityContext](https://github.com/openharmony/docs/blob/master/en/application-dev/reference/apis-ability-kit/js-apis-inner-application-uiAbilityContext.md)：外部链接与 Stage 上下文。

OpenHarmony 的参考 API 用于核对接口；最终以安装的 HarmonyOS SDK 编译结果和真实设备行为为准。
