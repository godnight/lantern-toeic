# 微光托业：Android / iOS 工程与构建

本仓库同时保留网页版与原生客户端。原生端是 `mobile/` 下的 Vite + Capacitor 工程，复用 `app/study-app.tsx`、练习组件和学习数据模型。它将本地前端资源打包进 App，不在 WebView 中加载远程 Site。

**当前状态：Android 和 iOS 源码已生成；原生编译、真机录音及分发尚未验证。** 本次开发环境有JDK17，但缺少所需JDK21、Android SDK及macOS/Xcode。不能把 Vite 构建或 `cap sync` 成功等同于 APK / iOS 构建成功。已加入Android自动打包和iOS模拟器编译工作流；实际执行结果见项目状态。

## 工程入口与数据边界

| 路径 | 职责 |
|---|---|
| `mobile/src/main.tsx` | 挂载 `<StudyApp owner={null} nativeMode />` |
| `mobile/vite.config.ts` | 引用仓库根依赖，打包共享 React UI 和 `public/` 资源 |
| `mobile/capacitor.config.ts` | 应用 ID `io.lantern.toeic`，名称“微光托业”，`webDir: 'dist'` |
| `mobile/android/` | Android Studio / Gradle 工程 |
| `mobile/ios/App/App.xcodeproj` | Xcode 工程，使用 Swift Package Manager |
| `lib/use-study.ts` | 学习记录、录音与同步逻辑；原生端没有云端 owner 身份 |

原生端的目标配置、作答和打卡保存在 WebView 的 localStorage；录音文件保存在 IndexedDB。未设置 owner 时，同步函数直接保持本地状态，不上传个人记录，也不获得网页版的登录会话。卸载应用、清除应用数据或系统回收存储可能造成数据丢失；当前不是持久云端备份方案。

网页版 / PWA 使用其已有认证与服务器接口；原生端、本机浏览器及其他设备分别拥有自己的本地存储。原生端尚不支持账号登录或跨设备同步。当前 JSON 导出包含学习数据及录音元数据，不包含 IndexedDB 中的录音文件；WebView 的下载 / 分享行为也需真机确认。

## 构建环境

当前 `mobile/package-lock.json` 固定 Capacitor 8.5.1，依赖安装应使用 `npm ci`。

| 平台 | 环境要求 |
|---|---|
| 共用 | Node 22.13+，推荐使用当前维护的 Node 22；npm |
| Android | JDK 21、Android Studio 2025.2.1+，或等价 SDK / 命令行工具 |
| Android SDK | Platform 36、Build Tools 36.0.0、Platform Tools；最低运行 API 24 |
| Android 构建 | 仓库 wrapper 使用 Gradle 8.14.3；项目使用 AGP 8.13.0 |
| iOS | macOS、Xcode 26+、Xcode Command Line Tools；最低 iOS 15 |
| iOS 依赖 | Swift Package Manager；生成工程已包含 SceneDelegate |

Android 的 `compileSdkVersion` / `targetSdkVersion` 为 36，`minSdkVersion` 为 24。这些是构建与运行基线；录音、系统朗读等能力仍依赖设备及 WebView 实现。

参考：[Capacitor 环境设置](https://capacitorjs.com/docs/getting-started/environment-setup)、[8.0 工程要求](https://capacitorjs.com/docs/updating/8-0)、[8.5 iOS 生命周期](https://capacitorjs.com/docs/updating/8-5)、[官方 Java 21 配置](https://github.com/ionic-team/capacitor/blob/main/android/capacitor/build.gradle)。

## Android 调试 APK

以下命令从仓库根目录开始；已经安装并配置 JDK 21、Android SDK，且已完成 SDK 许可设置。

```bash
npm ci
cd mobile
npm ci
npm run build
npx cap sync android
cd android
chmod +x gradlew
./gradlew --no-daemon assembleDebug
```

构建成功后，预期文件为 `mobile/android/app/build/outputs/apk/debug/app-debug.apk`。这是使用调试签名的内部测试包，不是正式商店发布版本。Windows 可在 `mobile/android` 中使用 `gradlew.bat assembleDebug`。

SDK 缺少时，可在 Android Studio 的 SDK Manager 中安装 Android 36 和 Build Tools 36.0.0；等价命令为：

```bash
sdkmanager "platform-tools" "platforms;android-36" "build-tools;36.0.0"
```

使用 Android Studio 打开时，在 `mobile/` 执行 `npm run android`。连接已授权的测试手机或启动模拟器，再运行 App。每次共享 UI 或静态资源更新后都需要重新执行 `npm run build` 和 `npx cap sync android`。

## iOS 本地构建

以下命令须在有 Xcode 的 Mac 上执行，从仓库根目录开始：

```bash
npm ci
cd mobile
npm ci
npm run build
npx cap sync ios
npm run ios
```

在 Xcode 中等待 Swift Package Manager 解析完成，选择 `App` scheme 和模拟器后构建。若使用实体设备，配置自己的签名 Team 和可用 Bundle ID；正式 TestFlight / App Store 分发另需相应开发者账号、签名和发布配置。这些尚未配置或提交。

可选的模拟器编译命令，在 `mobile/` 中执行：

```bash
xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Debug -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build
```

此命令仅检查模拟器目标是否可编译，不生成已签名、可分发的 iPhone 安装包。

## 麦克风与音频验收

共享口语组件使用 `getUserMedia({ audio: true })` 和 `MediaRecorder`。录音只能由用户点击练习动作后启动；页面关闭、录音停止和取消时应释放音频轨道。

打包前检查以下平台声明：

- Android：`mobile/android/app/src/main/AndroidManifest.xml` 包含 `android.permission.RECORD_AUDIO` 和 `android.permission.MODIFY_AUDIO_SETTINGS`；还需要系统运行时权限及 WebView 媒体授权正常通过，Manifest 声明本身不足以证明录音可用。
- iOS：`mobile/ios/App/App/Info.plist` 包含清楚说明口语练习用途的 `NSMicrophoneUsageDescription`；WKWebView 实际录音需真机验证。
- 不要求摄像头、通讯录、位置或宽泛存储权限。当前录音保存于应用自己的 WebView 存储。

两端必须实际验证：首次允许、拒绝后重试、准备倒计时、提前停止、倒计时结束、取消退出、回放、杀进程重开后再回放，以及音频与其他应用冲突时的提示。需检查 Safari / WKWebView 的 MP4 与 Android WebView 的 WebM 格式支持，不固定假定某一种格式可用。

听力起步包使用系统 `speechSynthesis`，不是内置真人音频。原生 WebView 是否提供该 API、英语声音是否可用，均需单独验证；不支持时应给出明确提示，不应承诺离线听力可用。原生文件下载、外部官方链接、状态栏安全区和键盘遮挡也在真机验收范围内。

## 自动原生构建

`.github/workflows/android-debug.yml` 在main相关代码更新、PR或手动操作时运行。另有 `ios-simulator.yml` 在macos-26编译无签名模拟器目标，不生成iPhone安装包。工作流只读检出仓库，安装根与 `mobile/` 两套锁定依赖，构建本地前端、同步 Android 工程，使用 JDK 21 / SDK 36 编译 debug APK，并上传成功生成的 APK 工件。

该流程不部署 Site，不调用生产模型，不注入用户凭证，也不发布商店包。Android流程还逐文件核对最终APK中的离线资源，并附校验和与来源信息。首次成功后才能标为编译通过；调试签名由临时runner生成，跨构建覆盖安装与数据保留暂不保证。编译通过仍不能替代真机录音和持久化验收。

## 下一阶段：移动身份与云同步

接入原生云端前，需要明确支持移动客户端的认证契约、登录 / 退出与授权回调、服务器逐用户授权、跨设备数据合并、录音上传及删除行为。客户端应调用经授权的 HTTPS API，密钥保留在服务器端。

Sites 的 owner-private 访问边界继续保留；不能复制浏览器 cookie、伪造 owner header、把 owner session 放进包，或通过公开 API 绕过平台访问许可。仅设置 API 地址不会获得登录身份。若现有托管平台没有受支持的移动认证方式，原生端继续作为本机版本，云同步保持未启用。

Capacitor `server.url` 是开发 live reload 配置，官方不建议用于生产；当前配置保持本地 `webDir`，不加入远程 Site URL。原生 HTTP 插件也只提供网络传输，不构成身份认证。[配置文档](https://capacitorjs.com/docs/config)、[HTTP 插件](https://capacitorjs.com/docs/apis/http)、[应用深链](https://capacitorjs.com/docs/guides/deep-links)。

## v0.2 录音改进

进入后台时取消准备或结束录音，录音开始与结束时间在事件发生时记录，不把后台等待计入音频时长。捕获录音器启动错误并释放麦克风。支持取消准备；原生界面不再承诺未接入的云同步。MP4录音下载名使用m4a后缀。原生文件下载/分享功能与系统返回键仍待完善，不能把JSON导出视为已验证的原生备份。
