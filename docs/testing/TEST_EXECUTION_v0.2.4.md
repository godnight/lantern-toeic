# v0.2.4 手机访问与账号边界测试执行报告

执行日期：2026-09-12（UTC）。范围为手机安装说明、Web/PWA与原生账号边界、版本同步及相关生产构建。总设计见 [40个跨端风险场景](TEST_DESIGN.md)。本报告只把实际执行的层级记为通过，不把共享资源构建写成HAP或真机验收。

## 自动化与构建

| 检查 | 结果 | 能证明与边界 |
|---|---|---|
| `npm run typecheck` | 通过 | 当前TypeScript可编译；不等于浏览器或SDK运行 |
| `npm run validate:content` | 通过：68道原创题、5类口语、22条官方资料 | 结构完整；不等于教师审校或复用许可 |
| `npm run validate:art` | 通过：3主题、8幅内置原创图、19个外部参考 | 目录、声明与哈希一致；不等于逐项视觉/许可复核 |
| `npm run test:study` | 通过：34/34 | 新增P07源码行为覆盖：Web/PWA同账号说明、原生本机说明、安全在线外链及不收集手机号 |
| Sites生产构建脚本 | 通过 | Vinext五阶段生产构建完成；`/`、`/api/study`、`/api/recordings`路由生成 |
| `node --test tests/*.test.mjs` | 通过：5/5 | 生产学习壳、安装元数据、CSS/语义构建后检查通过 |
| `npm --prefix mobile run build` | 通过 | Capacitor共享静态前端生成；约669 kB主JS触发既有分包警告，不代表APK/iPhone安装 |
| Harmony `sync:web` + `check:web` | 通过：23个共享文件一致 | 只证明ArkWeb内置网页资源同步，不是HAP编译 |
| Harmony工具链报告 | 阻塞 | 找到仓库Hvigor启动脚本；缺OHPM、HDC和SDK目录，`compiled/signed/deviceTested`均为false |
| `npm run lint` | 未通过：256错误、2290警告 | 仓库全量Lint包含既有源码、CommonJS测试与生成资源问题；本次正式门禁以类型、行为和构建为准，未把Lint误记为通过 |

## 手机入口与身份检查

- P07的L1渲染回归通过：Web/PWA展示HarmonyOS、Android、iPhone安装步骤，并说明同一ChatGPT账号同步。
- `nativeMode`展示本机保存边界，在线入口固定为生产Site，含新窗口隔离属性；测试同时验证链接目标与属性。
- 仓库没有手机号输入、验证码发送或短信供应商配置。本版不收集手机号，也不把演示表单写成真实认证。
- 生产构建通过后，受管预览服务启动成功；本轮环境没有可用的浏览器控制能力，因此没有补报真实点击、390/320像素截图或PWA安装L3证据。v0.2.3已有的布局截图仍是历史基线，不能代替本版弹窗验收。

## 尚未通过或未执行

- 未使用第二个授权账号执行真实D1/R2跨设备同步；没有向生产伪造身份头。
- 未在HarmonyOS、Android或iPhone真机执行添加桌面、外链返回、麦克风、覆盖升级与数据保留。
- 没有短信供应商、风控、账号合并或隐私配置，手机号登录未实现。
- 没有HarmonyOS SDK、签名材料和测试设备，未生成HAP。

源码发布、GitHub检查、线上Site部署与设备包是四类不同状态。提交后的GitHub与Site终态以各平台的提交、检查和部署记录为准；本报告不以“能访问URL”替代浏览器交互或真机证据。
